import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from argparse import Namespace
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


MMRAG_PATH = Path(__file__).with_name("mmrag.py")


def load_mmrag():
    spec = importlib.util.spec_from_file_location("mmrag_under_test", MMRAG_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeCollection:
    def __init__(self, *, distances=None):
        self.query_kwargs = None
        self.distances = distances or [0.01, 0.02, 0.03, 0.04, 0.05]

    def count(self):
        return 10

    def query(self, **kwargs):
        self.query_kwargs = kwargs
        docs = [
            "vector first",
            "vector second",
            "vector third",
            "vector fourth",
            "vector fifth",
        ]
        return {
            "ids": [["id1", "id2", "id3", "id4", "id5"]],
            "documents": [docs],
            "distances": [self.distances],
            "metadatas": [[{"source": f"source-{idx}.md"} for idx in range(1, 6)]],
        }


def fake_args(**overrides):
    values = {
        "question": "which result is best?",
        "collection": "test",
        "top_k": 2,
        "threshold": 0,
        "max_tokens": 0,
        "full": False,
        "type": None,
        "json": True,
    }
    values.update(overrides)
    return Namespace(**values)


class RerankTests(unittest.TestCase):
    def test_load_config_adds_rerank_defaults(self):
        mmrag = load_mmrag()
        with tempfile.NamedTemporaryFile("w", delete=False) as config_file:
            json.dump({"default_collection": "shared"}, config_file)
            config_path = config_file.name
        try:
            with patch.object(mmrag, "CONFIG_FILE", Path(config_path)):
                config = mmrag.load_config()
        finally:
            Path(config_path).unlink()

        self.assertFalse(config["rerank_enabled"])
        self.assertEqual(config["rerank_model"], "cross-encoder/ms-marco-MiniLM-L-6-v2")
        self.assertEqual(config["rerank_overfetch"], 5)

    def test_query_flag_off_uses_existing_overfetch_and_does_not_import_reranker(self):
        mmrag = load_mmrag()
        collection = FakeCollection()

        def guarded_import(name, *args, **kwargs):
            if name.startswith("sentence_transformers"):
                raise AssertionError("sentence-transformers must not import when rerank is disabled")
            return original_import(name, *args, **kwargs)

        original_import = __import__
        with patch.object(mmrag, "load_config", return_value={"rerank_enabled": False}), \
            patch.object(mmrag, "get_api_key", return_value="key"), \
            patch.object(mmrag, "get_genai_client", return_value=object()), \
            patch.object(mmrag, "get_chroma_collection", return_value=collection), \
            patch.object(mmrag, "embed_query", return_value=[0.1]), \
            patch("builtins.__import__", side_effect=guarded_import):
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                mmrag.cmd_query(fake_args())

        self.assertEqual(collection.query_kwargs["n_results"], 6)
        output = json.loads(stdout.getvalue())
        self.assertEqual([r["source"] for r in output["results"]], ["source-1.md", "source-2.md"])
        self.assertNotIn("rerank_score", output["results"][0])

    def test_query_flag_on_reranks_after_dedup_before_truncate(self):
        mmrag = load_mmrag()
        collection = FakeCollection()

        class FakeCrossEncoder:
            def __init__(self, model_name):
                self.model_name = model_name

            def predict(self, pairs):
                return [0.1, 0.95, 0.2, 0.4, 0.3][: len(pairs)]

        fake_module = types.SimpleNamespace(CrossEncoder=FakeCrossEncoder)
        with patch.dict(sys.modules, {"sentence_transformers": fake_module}), \
            patch.object(mmrag, "load_config", return_value={
                "rerank_enabled": True,
                "rerank_model": "fake-model",
                "rerank_overfetch": 5,
            }), \
            patch.object(mmrag, "get_api_key", return_value="key"), \
            patch.object(mmrag, "get_genai_client", return_value=object()), \
            patch.object(mmrag, "get_chroma_collection", return_value=collection), \
            patch.object(mmrag, "embed_query", return_value=[0.1]):
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                mmrag.cmd_query(fake_args())

        self.assertEqual(collection.query_kwargs["n_results"], 10)
        output = json.loads(stdout.getvalue())
        self.assertEqual([r["source"] for r in output["results"]], ["source-2.md", "source-4.md"])
        self.assertEqual(output["results"][0]["rerank_score"], 0.95)
        self.assertEqual(output["results"][0]["similarity"], 0.98)


if __name__ == "__main__":
    unittest.main()
