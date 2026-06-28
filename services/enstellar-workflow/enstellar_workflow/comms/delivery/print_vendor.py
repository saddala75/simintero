"""Print vendor client — stub implementation.

ponytail: stub — replace with real vendor SDK (Lob, PostGrid, etc.) when vendor is chosen.
Interface: submit(notification_id, body) -> confirmation_id str.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class PrintVendorClient:
    async def submit(self, notification_id: str, body: str) -> str:
        logger.info(
            "print_vendor_stub notification_id=%s body_len=%d",
            notification_id, len(body),
        )
        return f"stub-{notification_id}"
