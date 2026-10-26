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
ADDED_CODE_PATHS = frozenset(("reconcile_claim40_superseded.cjs", "claim40_closure_cases.cjs",
                             "reconcile_nodekit_pointer_partial.cjs", "test_nodekit_pointer_partial.cjs",
                             "reconcile_bori_prepared_mcp.cjs", "test_bori_prepared_mcp.cjs",
                             "continue_bori_prepared_mcp.js",
                             "supervision_gate.js", "recover_unwritten.cjs",
                             "test_fenced_dispatch.cjs", "test_unwritten_recovery.cjs",
                             "case_exception.cjs", "case_gate.cjs", "central_case_owner.js", "recover_exception.cjs", "test_case_exception.cjs", "test-fixtures/case_mcp_stub.cjs"))
# This PR now includes a separately identified post-import P1 correction. These
# paths are not represented as unchanged bytes; all other imported paths are.
CORRECTIONS = frozenset(("broker.cjs", "test_guard.cjs", "router_stale_prewrite_cases.cjs",
                         "transport_preprepare_cases.cjs", "v02_partial_cases.cjs"))
FINDING = "https://github.com/HeaInSeo/notion-projection-guard/pull/1#discussion_r4320358702"
# Reviewed operational source updates are separate from the immutable import
# and correction commit. Never obtain these pins from a mutable manifest.
SOURCE_UPDATES = {
    "test-fixtures/case_mcp_stub.cjs": "b57e2bd4ead7d83d47d2cefa552da4fb1796541b",
    "test_case_exception.cjs": "95913086818681979dae945aa319d531a431c9f1",
    "recover_exception.cjs": "77266614a91d5c9779ebe72ab129dfb38b89055a",
    "central_case_owner.js": "1597432135c61b3d81ad0bcafe3239958a73e716",
    "case_gate.cjs": "79c64d90cc8c8ca6863f3ea8328c09daa47e6283",
    "case_exception.cjs": "73f500fcd5e295bc319d5dc33579dea2dbc93a3e",
    "test_unwritten_recovery.cjs": "72ff2bdca1e1fb55cf4c81c387c563bc9646c25b",
    "test_fenced_dispatch.cjs": "547e42b06748232476a76528ac37fffc710fa40a",
    "recover_unwritten.cjs": "e3cbf9f0c41ac83d6021d5e1a4d1a9fb4a5c89e6",
    "continue_bori_prepared_mcp.js": "537f58e7574f5c62511a2d866b2d2c862eba7cbb",
    "test_bori_prepared_mcp.cjs": "efd1e293977e68b19e64e3060faa9e0aac891288",
    "reconcile_bori_prepared_mcp.cjs": "584e852f060a3f12c240de0e509cbde29c9739bb",
    "test_runtime.cjs": "a256321fa40ab30078d67aef17e120848eac9936",
    "supervision_gate.js": "da8014c8e4718016e1cb6689ced28a8bafc89791",
    "complete_projection_cases.cjs": "f032dd8fb38436cd7fa68f3de2cd3db4ec1ed38c",
    "transport_preprepare_cases.cjs": "4f1737873592c57e07f1dd1a676587319ae1182b",
    "router_stale_prewrite_cases.cjs": "6914f417d20f590c12c7ffaf1b2df122cefc5dd5",
    "broker.cjs": "5bb07b2e25e676e697d6dca097d0e7d1f9bb62f3",
    "runner.js": "9b16539116ace0478e652ca1a3b546b916d5a1dd",
    "test_guard.cjs": "79fafd8a8a2062d7e3064842bb06d002956138ab",
    "reconcile_claim40_superseded.cjs": "562fa5e9988cfc2f7d73e4c46f035f9e89830678",
    "claim40_closure_cases.cjs": "c7b5973e74bd3a75b46cacc770e984bf0c1ae5ce",
    "reconcile_nodekit_pointer_partial.cjs": "77310ea22bd8ce455fe3f87e828286e21ead6d4f",
    "test_nodekit_pointer_partial.cjs": "b9bd718a5f2c919ed1ba3813284abb9b639e4233",
    "complete_projection.js": "751688e9628fcc996c26587a7fbb9673fef9fe82",
    "verify_runtime.cjs": "fd7c6fe55acddca806b6a6afa8e9576d8b254e0b",
}


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def verify(root, anchors=ANCHORS, source_updates=SOURCE_UPDATES):
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
    require(set(source_updates) <= CODE_PATHS | ADDED_CODE_PATHS and all(
        isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value)
        for value in source_updates.values()), "invalid source update pins")
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
        if name in source_updates:
            require(actual == source_updates[name], "pinned operational source differs: " + name)
        elif name in CORRECTIONS:
            require(actual == rev(anchors["correctionCommit"] + ":" + name), "pinned correction blob differs: " + name)
        else:
            require(actual == original, "undeclared post-import code change: " + name)
        require(git("ls-tree", imported, "--", name).split()[0] == git("ls-tree", "HEAD", "--", name).split()[0], "code mode differs: " + name)
    for name in sorted(set(source_updates) - CODE_PATHS):
        file = root / name
        require(file.is_file() and not file.is_symlink(), "non-regular added code: " + name)
        data = file.read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        require(actual == source_updates[name], "pinned added source differs: " + name)
        require(git("ls-tree", "HEAD", "--", name).split()[0] == b"100644", "added code mode differs: " + name)
        changed.add(name)
    require(changed == CORRECTIONS | set(source_updates), "declared correction set differs from actual code delta")
    return {"historyPairs": len(entries), "migrationBlobs": len(CODE_PATHS),
            "unchangedCurrentBlobs": len(CODE_PATHS - CORRECTIONS - set(source_updates)),
            "postImportChanges": sorted(changed), "operationalSourceUpdates": sorted(source_updates)}


if __name__ == "__main__":
    try:
        print(json.dumps(verify(pathlib.Path.cwd()), sort_keys=True))
    except (VerificationError, KeyError, ValueError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print("PROVENANCE_FAILED: " + str(error), file=sys.stderr)
        sys.exit(1)
