from pydantic import BaseModel, ConfigDict


class OutModel(BaseModel):
    """A response body.

    Responses always include fields that have defaults, so the OpenAPI schema
    lists them as required and the generated web types match what is sent.
    """

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)
