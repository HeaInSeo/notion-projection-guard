#!/usr/bin/env python3
"""Verify the immutable import, every history pair, and declared later changes."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

ANCHORS = {
    "sourceRepository": "HeaInSeo/infra-lab",
    "sourcePath": "ops/notion-projection-guard",
    "sourceCommit": "6ea3729948a9210c557b82094caee44ab3889560",
    "sourceArchive": "archive/npg-before-split-20261020",
    "targetRepository": "HeaInSeo/notion-projection-guard",
    "targetPath": ".",
    "importCommit": "890e9d38e4a0a50a6a44232fe378da2f7f7727fa",
    "importTag": "import/infra-lab-20261020",
    "importTree": "366a7e650a7b71bb0bc4d0b3e2b0a7d326cff7b2",
    "migrationCommit": "089aea20a24326d71f8c51f38c4e5d7bc7337cb5",
    "correctionCommit": "5b67791a51aa4637571adf5c45989922c91190fd",
    "preservedCommits": 35,
    "historyMap": "history/infra-lab-commit-map.json",
}
SOURCE_REF = "refs/provenance/npg-source-archive"
CODE_PATHS = frozenset((
    "broker.cjs", "runner.js", "complete_projection.js", "verify_runtime.cjs",
    "test_guard.cjs", "test_runtime.cjs", "complete_projection_cases.cjs",
    "reconcile_preflight_connection.cjs", "reconcile_router_stale_prewrite.cjs",
    "reconcile_transport_preprepare.cjs", "reconcile_v02_partial.cjs",
    "reconcile_w02_prewrite.cjs", "router_stale_prewrite_cases.cjs",
    "transport_preprepare_cases.cjs", "v02_partial_cases.cjs",
))
# This PR now includes a separately identified post-import P1 correction. These
# paths are not represented as unchanged bytes; all other imported paths are.
CORRECTIONS = frozenset(("broker.cjs", "test_guard.cjs", "router_stale_prewrite_cases.cjs",
                         "transport_preprepare_cases.cjs", "v02_partial_cases.cjs"))
FINDING = "https://github.com/HeaInSeo/notion-projection-guard/pull/1#discussion_r4320358702"


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def verify(root, anchors=ANCHORS):
    root = pathlib.Path(root)

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.PIPE)

    def rev(expression):
        return git("rev-parse", "--verify", expression).decode().strip()

    def ancestor(commit, head):
        git("merge-base", "--is-ancestor", commit, head)

    def author_message(commit):
        headers, message = git("cat-file", "commit", commit).split(b"\n\n", 1)
        return [line for line in headers.splitlines() if line.startswith((b"author ", b"encoding "))], message

    meta = json.loads((root / "deployment/source-import.json").read_text())
    require(meta["version"] == 2, "source manifest version")
    for key, value in anchors.items():
        require(meta.get(key) == value, "immutable anchor differs: " + key)
    source, imported, migration = (anchors[key] for key in ("sourceCommit", "importCommit", "migrationCommit"))
    require(rev(SOURCE_REF + "^{commit}") == source, "source archive tag target differs")
    require(rev("refs/tags/" + anchors["importTag"] + "^{commit}") == imported, "import tag target differs")
    require(rev(imported + "^{tree}") == anchors["importTree"], "import tree differs")
    require(rev(source + ":" + anchors["sourcePath"]) == anchors["importTree"], "source subtree differs")
    ancestor(imported, migration)
    ancestor(migration, "HEAD")
    ancestor(migration, anchors["correctionCommit"])
    ancestor(anchors["correctionCommit"], "HEAD")

    history = json.loads((root / anchors["historyMap"]).read_text())
    for key in ("sourceRepository", "sourcePath", "targetRepository", "targetPath"):
        require(history.get(key) == anchors[key], "history metadata differs: " + key)
    require(history.get("sourceHead") == source and history.get("importHead") == imported, "history heads differ")
    entries = history["commits"]
    require(len(entries) == anchors["preservedCommits"], "history count differs")
    for entry in entries:
        require(set(entry) == {"sourceCommit", "importCommit", "subtreeTree"}, "invalid history entry")
        require(all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) for value in entry.values()), "invalid history SHA")
    sources = [entry["sourceCommit"] for entry in entries]
    imports = [entry["importCommit"] for entry in entries]
    require(len(set(sources)) == len(entries) and len(set(imports)) == len(entries), "duplicate history mapping")
    # Git rewrites parents across commits that do not affect the extracted
    # path. Compare that path-filtered graph, preserving merge-parent order.
    def graph(*args):
        return {parts[0]: parts[1:] for parts in
                (line.split() for line in git("rev-list", "--parents", *args).decode().splitlines())}
    source_graph = graph(source, "--", anchors["sourcePath"])
    import_graph = graph(imported)
    require(set(sources) == set(source_graph) and set(imports) == set(import_graph), "history mapping is not exhaustive")
    mapping = dict(zip(sources, imports))
    for entry in entries:
        old, new, tree = (entry[key] for key in ("sourceCommit", "importCommit", "subtreeTree"))
        ancestor(old, source)
        ancestor(new, imported)
        require(rev(old + ":" + anchors["sourcePath"]) == rev(new + "^{tree}") == tree, "mapped tree differs: " + old)
        require(author_message(old) == author_message(new), "mapped author/date/message differs: " + old)
        require(all(parent in mapping for parent in source_graph[old]), "unmapped source parent")
        require([mapping[parent] for parent in source_graph[old]] == import_graph[new], "mapped parent topology differs: " + old)

    paths = set(git("ls-tree", "-r", "--name-only", imported).decode().splitlines())
    require({name for name in paths if name.endswith((".cjs", ".js"))} == CODE_PATHS, "fixed imported code path set differs")
    blobs = meta["importedCodeBlobs"]
    require(set(blobs) == CODE_PATHS, "manifest code path set differs")
    changes = meta["postImportChanges"]
    require(isinstance(changes, list) and len(changes) == len(CORRECTIONS), "correction path count differs")
    require({entry["path"] for entry in changes} == CORRECTIONS and all(entry.get("finding") == FINDING for entry in changes), "undeclared correction paths")
    changed = set()
    for name in sorted(CODE_PATHS):
        original = rev(imported + ":" + name)
        require(blobs[name] == original, "import blob metadata differs: " + name)
        require(rev(migration + ":" + name) == original, "migration bytes differ from immutable import: " + name)
        file = root / name
        require(file.is_file() and not file.is_symlink(), "non-regular code file: " + name)
        data = file.read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if actual != original:
            changed.add(name)
        if name in CORRECTIONS:
            require(actual == rev(anchors["correctionCommit"] + ":" + name), "pinned correction blob differs: " + name)
        else:
            require(actual == original, "undeclared post-import code change: " + name)
        require(git("ls-tree", imported, "--", name).split()[0] == git("ls-tree", "HEAD", "--", name).split()[0], "code mode differs: " + name)
    require(changed == CORRECTIONS, "declared correction set differs from actual code delta")
    return {"historyPairs": len(entries), "migrationBlobs": len(CODE_PATHS),
            "unchangedCurrentBlobs": len(CODE_PATHS - CORRECTIONS), "postImportChanges": sorted(changed)}


if __name__ == "__main__":
    try:
        print(json.dumps(verify(pathlib.Path.cwd()), sort_keys=True))
    except (VerificationError, KeyError, ValueError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print("PROVENANCE_FAILED: " + str(error), file=sys.stderr)
        sys.exit(1)
