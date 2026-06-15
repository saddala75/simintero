package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record Actor(
    @JsonProperty("id") String id,
    @JsonProperty("type") String type
) {}
