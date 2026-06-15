from fastapi import HTTPException, status


class AuthError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail,
                         headers={"WWW-Authenticate": "Bearer"})


class ForbiddenError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class TenantMissingError(AuthError):
    def __init__(self) -> None:
        super().__init__("Token is missing required tenant_id claim")
