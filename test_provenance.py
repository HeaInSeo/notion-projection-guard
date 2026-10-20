"""Exercise provenance failures against real temporary Git objects, without network."""
import copy
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from verify_provenance import ANCHORS, CODE_PATHS, CORRECTIONS, FINDING, SOURCE_REF, VerificationError, verify


def git(root, *args, data=None, env=None):
    return subprocess.check_output(["git", *args], cwd=root, input=data, env=env, stderr=subprocess.PIPE).decode().strip()


class ProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = tempfile.TemporaryDirectory(prefix="npg-history-template-")
        root = pathlib.Path(cls.template.name)
        git(root, "init", "-q")
        git(root, "config", "user.name", "Fixture Author")
        git(root, "config", "user.email", "fixture@example.invalid")
        folder = root / ANCHORS["sourcePath"]
        folder.mkdir(parents=True)
        for name in CODE_PATHS:
            (folder / name).write_text("baseline " + name + "\n")
        entries, parent = [], None
        for n in range(35):
            (folder / "broker.cjs").write_text("source revision " + str(n) + "\n")
            git(root, "add", ".")
            env = dict(os.environ, GIT_AUTHOR_DATE="2026-10-01T00:00:%02d+0900" % n,
                       GIT_COMMITTER_DATE="2026-10-01T00:00:%02d+0900" % n)
            git(root, "commit", "-qm", "source " + str(n), env=env)
            old = git(root, "rev-parse", "HEAD")
            tree = git(root, "rev-parse", "HEAD:" + ANCHORS["sourcePath"])
            args = ["commit-tree", tree] + (["-p", parent] if parent else [])
            parent = git(root, *args, data=("source " + str(n) + "\n").encode(), env=env)
            entries.append({"sourceCommit": old, "importCommit": parent, "subtreeTree": tree})
        git(root, "update-ref", SOURCE_REF, old)
        git(root, "tag", ANCHORS["importTag"], parent)
        git(root, "checkout", "--detach", "-q", parent)
        cls.anchors = dict(ANCHORS, sourceCommit=old, importCommit=parent, importTree=tree, migrationCommit=parent)
        history = {key: cls.anchors[key] for key in ("sourceRepository", "sourcePath", "targetRepository", "targetPath")}
        history.update(version=1, sourceHead=old, importHead=parent, commits=entries)
        meta = dict(cls.anchors, version=2,
                    importedCodeBlobs={name: git(root, "rev-parse", parent + ":" + name) for name in CODE_PATHS},
                    postImportChanges=[{"path": name, "finding": FINDING} for name in sorted(CORRECTIONS)])
        for name in CORRECTIONS:
            with (root / name).open("a") as file:
                file.write("explicit post-import revision correction\n")
        (root / "deployment").mkdir()
        (root / "history").mkdir()
        (root / "deployment/source-import.json").write_text(json.dumps(meta))
        (root / ANCHORS["historyMap"]).write_text(json.dumps(history))
        git(root, "add", ".")
        git(root, "commit", "-qm", "post-import corrections")

    @classmethod
    def tearDownClass(cls):
        cls.template.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="npg-history-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name) / "repo"
        shutil.copytree(self.template.name, self.root)

    def change_json(self, path, mutate):
        file = self.root / path
        value = json.loads(file.read_text())
        mutate(value)
        file.write_text(json.dumps(value))

    def rejected(self, fragment):
        with self.assertRaisesRegex(VerificationError, fragment):
            verify(self.root, self.anchors)

    def test_all_35_pairs_and_explicit_code_delta_pass(self):
        report = verify(self.root, self.anchors)
        self.assertEqual(report["historyPairs"], 35)
        self.assertEqual(report["migrationBlobs"], 15)
        self.assertEqual(report["postImportChanges"], sorted(CORRECTIONS))

    def test_35_duplicate_pairs_fail(self):
        self.change_json(ANCHORS["historyMap"], lambda h: h.update(commits=[h["commits"][0]] * 35))
        self.rejected("duplicate history")

    def test_fictitious_mapping_fails(self):
        self.change_json(ANCHORS["historyMap"], lambda h: h["commits"][0].update(importCommit="f" * 40))
        self.rejected("not exhaustive")

    def test_misattributed_real_pair_fails(self):
        def swap(history):
            a, b = history["commits"][:2]
            a["importCommit"], b["importCommit"] = b["importCommit"], a["importCommit"]
        self.change_json(ANCHORS["historyMap"], swap)
        self.rejected("mapped tree differs")

    def test_mapped_tree_is_not_trusted(self):
        self.change_json(ANCHORS["historyMap"], lambda h: h["commits"][0].update(subtreeTree="f" * 40))
        self.rejected("mapped tree differs")

    def test_declared_heads_and_archive_targets_are_checked(self):
        self.change_json(ANCHORS["historyMap"], lambda h: h.update(sourceHead="f" * 40))
        self.rejected("history heads")
        git(self.root, "update-ref", SOURCE_REF, self.anchors["importCommit"])
        self.rejected("source archive tag target")

    def test_code_and_mutable_manifest_changed_together_still_fail(self):
        path = self.root / "runner.js"
        path.write_text(path.read_text() + "unreviewed change\n")
        blob = git(self.root, "hash-object", "runner.js")
        self.change_json("deployment/source-import.json", lambda m: m["importedCodeBlobs"].update({"runner.js": blob}))
        self.rejected("import blob metadata differs")

    def test_removed_manifest_path_fails(self):
        self.change_json("deployment/source-import.json", lambda m: m["importedCodeBlobs"].pop("runner.js"))
        self.rejected("manifest code path set")

    def test_undeclared_executable_change_fails(self):
        path = self.root / "runner.js"
        path.write_text("unreviewed change\n")
        self.rejected("undeclared post-import code change")


if __name__ == "__main__":
    unittest.main()
