import numpy as np
import pytest

from drone_fly.course import make_course
from drone_fly.physics import MASS, Flight


def test_course_seed_reproducibility_and_geometry():
    assert make_course(42) == make_course(42)
    assert make_course(42) != make_course(43)
    assert len(make_course(42).gates) == 5
    for gate in make_course(42).gates:
        assert gate.z - gate.height / 2 > 0
    with pytest.raises(ValueError):
        make_course(42, "invalid")


def test_four_rotor_hover_balances_gravity_without_teleportation():
    with Flight(render=False) as flight:
        start = flight.position
        assert flight.model.nu == 4
        for _ in range(100):
            flight.step([0, 0, 0])
        np.testing.assert_allclose(flight.position, start, atol=1e-6)
        np.testing.assert_allclose(sum(flight.data.ctrl), MASS * 9.81, atol=1e-5)
        assert flight.status == "flying"


def test_velocity_commands_act_through_attitude_and_rotors():
    with Flight(render=False) as flight:
        flight.step([1, 0.3, 0.2])
        assert flight.position[0] < 0.01  # finite acceleration, not velocity teleportation
        assert not np.allclose(flight.data.ctrl, flight.data.ctrl[0])
        assert not np.allclose(flight.data.qpos[3:7], [1, 0, 0, 0])
        for _ in range(50):
            flight.step([1, 0.3, 0.2])
        assert flight.position[0] > 1
        assert flight.position[1] > 0.3
        assert flight.position[2] > 2


def test_collision_terminates_and_terminal_state_does_not_advance():
    with Flight(render=False) as flight:
        for _ in range(120):
            flight.step([0, 2, 0])
            if flight.status != "flying":
                break
        assert flight.status == "collision"
        assert flight.collision == "leftwall"
        t = flight.data.time
        pos = flight.position
        flight.step([1, 0, 0])
        assert flight.data.time == t
        np.testing.assert_array_equal(flight.position, pos)


def test_wind_is_a_physical_force_and_invalid_commands_rejected():
    with Flight(render=False) as flight:
        flight.gust = 0.3
        for _ in range(20):
            flight.step([0, 0, 0])
        assert flight.position[1] > 0.05
        with pytest.raises(ValueError):
            flight.step([float("nan"), 0, 0])
