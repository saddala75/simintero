"""Unit tests for SmtpEmailSender. Uses smtplib mock — no real SMTP server."""
import pytest
from unittest.mock import MagicMock, patch

from enstellar_workflow.comms.delivery.email import SmtpEmailSender


@pytest.mark.asyncio
async def test_send_calls_starttls_login_and_send_message():
    sender = SmtpEmailSender(
        host="smtp.example.com",
        port=587,
        username="user@example.com",
        password="secret",
        from_addr="noreply@example.com",
    )

    with patch("smtplib.SMTP") as mock_cls:
        mock_smtp = MagicMock()
        mock_cls.return_value.__enter__ = MagicMock(return_value=mock_smtp)
        mock_cls.return_value.__exit__ = MagicMock(return_value=False)

        await sender.send(
            to="member@example.com",
            subject="Your PA determination",
            body="Your prior authorization was approved.",
        )

        mock_cls.assert_called_once_with("smtp.example.com", 587)
        mock_smtp.starttls.assert_called_once()
        mock_smtp.login.assert_called_once_with("user@example.com", "secret")
        mock_smtp.send_message.assert_called_once()
        msg = mock_smtp.send_message.call_args[0][0]
        assert msg["To"] == "member@example.com"
        assert msg["Subject"] == "Your PA determination"
        assert msg["From"] == "noreply@example.com"


@pytest.mark.asyncio
async def test_send_uses_configured_from_addr():
    sender = SmtpEmailSender(
        host="localhost", port=587, username="", password="",
        from_addr="pa-notices@payer.com",
    )

    with patch("smtplib.SMTP") as mock_cls:
        mock_smtp = MagicMock()
        mock_cls.return_value.__enter__ = MagicMock(return_value=mock_smtp)
        mock_cls.return_value.__exit__ = MagicMock(return_value=False)

        await sender.send(to="dr@clinic.com", subject="PA Notice", body="Body.")

        msg = mock_smtp.send_message.call_args[0][0]
        assert msg["From"] == "pa-notices@payer.com"
