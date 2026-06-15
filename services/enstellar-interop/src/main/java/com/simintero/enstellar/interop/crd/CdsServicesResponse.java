package com.simintero.enstellar.interop.crd;

import java.util.List;

/** CDS Hooks invoke response: a list of advisory cards. */
public record CdsServicesResponse(List<Card> cards) {}
