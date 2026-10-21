"""Exercise provenance failures against real temporary Git objects, without network."""
import hashlib
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
        # This fixture is copied immediately after creating many Git objects.
        # Background maintenance must not repack/delete them during copytree.
        git(root, "config", "gc.auto", "0")
        git(root, "config", "maintenance.auto", "false")
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
        cls.anchors["correctionCommit"] = git(root, "rev-parse", "HEAD")
        meta.update(cls.anchors)
        (root / "deployment/source-import.json").write_text(json.dumps(meta))
        git(root, "add", ".")
        git(root, "commit", "-qm", "pin correction commit")

    @classmethod
    def tearDownClass(cls):
        cls.template.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="npg-history-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name) / "repo"
        shutil.copytree(self.template.name, self.root)
        self.anchors = dict(type(self).anchors)

    def change_json(self, path, mutate):
        file = self.root / path
        value = json.loads(file.read_text())
        mutate(value)
        file.write_text(json.dumps(value))

    def rejected(self, fragment):
        with self.assertRaisesRegex(VerificationError, fragment):
            verify(self.root, self.anchors, {})

    def test_all_35_pairs_and_explicit_code_delta_pass(self):
        report = verify(self.root, self.anchors, {})
        self.assertEqual(report["historyPairs"], 35)
        self.assertEqual(report["migrationBlobs"], 15)
        self.assertEqual(report["postImportChanges"], sorted(CORRECTIONS))

    def test_new_closure_executable_is_pinned_and_tampering_fails(self):
        name = "reconcile_claim40_superseded.cjs"
        file = self.root / name
        file.write_text("reviewed closure source\n")
        git(self.root, "add", name)
        git(self.root, "commit", "-qm", "add reviewed closure fixture")
        pins = {name: git(self.root, "rev-parse", "HEAD:" + name)}
        self.assertIn(name, verify(self.root, self.anchors, pins)["operationalSourceUpdates"])
        file.write_text("unreviewed journal writer\n")
        with self.assertRaisesRegex(VerificationError, "pinned added source differs"):
            verify(self.root, self.anchors, pins)

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

    def test_every_permitted_correction_is_pinned(self):
        for name in CORRECTIONS:
            with self.subTest(path=name):
                file = self.root / name
                before = file.read_bytes()
                file.write_text("arbitrary replacement\n")
                self.rejected("pinned correction blob differs")
                file.write_bytes(before)

    def test_explicit_operational_updates_preserve_the_immutable_import(self):
        pins = {}
        for name in ("broker.cjs", "complete_projection.js"):
            file = self.root / name
            file.write_text(file.read_text() + "reviewed operational update\n")
            data = file.read_bytes()
            pins[name] = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        report = verify(self.root, self.anchors, pins)
        self.assertEqual(report["historyPairs"], 35)
        self.assertEqual(report["operationalSourceUpdates"], sorted(pins))
        for name in pins:
            with self.subTest(path=name):
                file = self.root / name
                before = file.read_bytes()
                file.write_text("unreviewed replacement\n")
                with self.assertRaisesRegex(VerificationError, "pinned operational source differs"):
                    verify(self.root, self.anchors, pins)
                file.write_bytes(before)

    def test_operational_pins_do_not_admit_changes_to_the_runner(self):
        file = self.root / "runner.js"
        file.write_text("unreviewed runner\n")
        with self.assertRaisesRegex(VerificationError, "undeclared post-import code change"):
            verify(self.root, self.anchors, {})

    def rewrite_import(self, extra_parent=False, bad_author=False, bad_message=False):
        """Retain all 35 source trees/messages while changing selected Git facts."""
        file = self.root / ANCHORS["historyMap"]
        history = json.loads(file.read_text())
        rebuilt = []
        for n, entry in enumerate(history["commits"]):
            env = dict(os.environ, GIT_AUTHOR_DATE="2026-10-01T00:00:%02d+0900" % n,
                       GIT_COMMITTER_DATE="2026-10-01T00:00:%02d+0900" % n)
            if bad_author and n == 3:
                env["GIT_AUTHOR_NAME"] = "Wrong Author"
            parents = ["-p", rebuilt[-1]] if rebuilt else []
            if extra_parent and n == 3:
                parents += ["-p", rebuilt[0]]
            message = "wrong message" if bad_message and n == 3 else "source " + str(n)
            new = git(self.root, "commit-tree", entry["subtreeTree"], *parents,
                      data=(message + "\n").encode(), env=env)
            rebuilt.append(new)
            entry["importCommit"] = new
        new_import = rebuilt[-1]
        correction_tree = git(self.root, "rev-parse", self.anchors["correctionCommit"] + "^{tree}")
        correction = git(self.root, "commit-tree", correction_tree, "-p", new_import, data=b"corrected source\n")
        head = git(self.root, "commit-tree", "HEAD^{tree}", "-p", correction, data=b"manifest pin\n")
        git(self.root, "reset", "--soft", head)
        git(self.root, "tag", "-f", ANCHORS["importTag"], new_import)
        self.anchors.update(importCommit=new_import, migrationCommit=new_import, correctionCommit=correction)
        self.change_json("deployment/source-import.json", lambda meta: meta.update(self.anchors))
        history["importHead"] = new_import
        file.write_text(json.dumps(history))

    def test_rewired_merge_with_identical_members_trees_and_messages_fails(self):
        self.rewrite_import(extra_parent=True)
        self.rejected("mapped parent topology differs")

    def test_changed_author_fails(self):
        self.rewrite_import(bad_author=True)
        self.rejected("mapped author/date/message differs")

    def test_changed_message_fails(self):
        self.rewrite_import(bad_message=True)
        self.rejected("mapped author/date/message differs")


if __name__ == "__main__":
    unittest.main()
