class AuthError(Exception):
    """JWT identity validation failed."""


class ForbiddenError(Exception):
    def __init__(self, message: str = "Forbidden") -> None:
        super().__init__(message)
        self.code = "SIM-AUTHZ-0001"
        self.status = 403
