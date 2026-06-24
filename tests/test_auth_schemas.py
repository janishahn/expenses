import pytest
from pydantic import ValidationError

from expenses.schemas import AdminElevationIn, AuthCredentialsIn


def test_auth_credentials_trim_username_and_reject_blank_values() -> None:
    payload = AuthCredentialsIn(username="  bootstrap  ", password="pw-12345")

    assert payload.username == "bootstrap"
    assert payload.password == "pw-12345"

    with pytest.raises(ValidationError):
        AuthCredentialsIn(username="   ", password="pw-12345")

    with pytest.raises(ValidationError):
        AuthCredentialsIn(username="bootstrap", password="   ")


def test_admin_elevation_rejects_blank_password() -> None:
    payload = AdminElevationIn(password="pw-12345")

    assert payload.password == "pw-12345"

    with pytest.raises(ValidationError):
        AdminElevationIn(password="   ")
