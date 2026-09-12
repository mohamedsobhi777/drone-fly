import asyncio
import json

import pytest
from fastapi import HTTPException

from drone_fly import server
from drone_fly.experiments import load_models


def test_real_background_training_activation_overlap_and_cancellation(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "LOCAL", tmp_path)
    monkeypatch.setattr(server, "ACTIVE", tmp_path / "active-models.json")

    async def exercise():
        jobs = server.Jobs()
        await jobs.start(server.JobRequest(mode="train", courses=2))
        with pytest.raises(HTTPException) as exc:
            await jobs.start(server.JobRequest(mode="train", courses=2))
        assert exc.value.status_code == 409
        await asyncio.wait_for(jobs.task, 60)
        assert jobs.state["status"] == "complete"
        marker = json.loads(server.ACTIVE.read_text())
        trained = load_models(tmp_path / marker["path"])
        assert len(trained["trainingSeeds"]) == 2
        assert trained["samples"] > 500
        assert server.model_path() == tmp_path / marker["path"]
        saved = server.ACTIVE.read_text()
        await jobs.start(server.JobRequest(mode="train", courses=24))
        await jobs.cancel()
        assert jobs.state["status"] == "cancelled"
        assert jobs.process.returncode is not None
        assert server.ACTIVE.read_text() == saved

    asyncio.run(exercise())
