from pydantic_settings import BaseSettings, SettingsConfigDict


class BffSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BFF_", case_sensitive=False)

    workflow_engine_url: str = "http://workflow-engine:8000"
    keycloak_jwks_url: str = (
        "http://keycloak:8180/realms/enstellar/protocol/openid-connect/certs"
    )
    fhir_api_url: str = "http://interop:8080/fhir"
    crd_api_url: str = "http://interop:8080/cds-services"


settings = BffSettings()
