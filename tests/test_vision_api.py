import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from drone_fly.physics import Flight
from drone_fly.server import Command, Session, app
from drone_fly.vision import encode


def test_actual_camera_gate_moves_in_image_when_aircraft_moves():
    with Flight() as flight:
        first, detection, _ = encode(flight.observe(), flight.velocity)
        assert detection["visible"]
        assert detection["pixels"] > 20
        # Test setup relocation only; step() never sets qpos directly.
        flight.data.qpos[1] += 0.5
        second, _, _ = encode(flight.observe(), flight.velocity)
        assert second[0] > first[0]


def test_masking_changes_pixels_and_preserves_inertial_observations():
    image = np.zeros((120, 160, 3), dtype=np.uint8)
    image[30:90, 10:60] = [240, 40, 15]
    intact, detection, _ = encode(image, [1, 0.3, -0.2])
    blind, no_detection, pixels = encode(image, [1, 0.3, -0.2], "blind")
    half, half_detection, _ = encode(image, [1, 0.3, -0.2], "left-eye")
    assert detection["visible"]
    assert not no_detection["visible"] and not half_detection["visible"]
    assert not pixels.any()
    np.testing.assert_array_equal(intact[5:], blind[5:])
    np.testing.assert_array_equal(blind, half)


def test_pause_freezes_physics_and_neural_state_then_reset_clears_intervention():
    session = Session()
    try:
        session.apply(Command(action="start"))
        session.frame()
        session.apply(Command(action="pause"))
        first = session.frame()
        second = session.frame()
        assert first["time"] == second["time"]
        assert first["activity"] == second["activity"]
        session.apply(Command(action="intervention", intervention="blind"))
        assert not session.frame()["vision"]["visible"]
        session.apply(Command(action="reset", seed=51, difficulty="slalom"))
        assert session.flight.data.time == 0
        assert session.flight.course.seed == 51
        assert session.intervention == "none"
    finally:
        session.flight.close()


def test_api_health_models_results_and_input_validation():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["physics"] == "MuJoCo"
        assert client.get("/api/circuit").json()["manifest"]["nodes"] == 80
        assert client.get("/api/models").json()["samples"] > 1000
        assert len(client.get("/api/benchmark").json()["conditions"]) == 8
        assert client.post("/api/jobs", json={"mode": "invalid", "courses": 1}).status_code == 422
        assert (
            client.post(
                "/api/jobs", json={"mode": "train", "courses": 2}, headers={"Origin": "https://example.com"}
            ).status_code
            == 403
        )
    with pytest.raises(ValidationError):
        Command(action="reset", seed=-1)
    with pytest.raises(ValidationError):
        Command(action="gust", force=float("nan"))
