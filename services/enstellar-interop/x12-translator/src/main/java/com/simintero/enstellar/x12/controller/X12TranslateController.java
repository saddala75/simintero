package com.simintero.enstellar.x12.controller;

import com.simintero.enstellar.canonical.Case;
import com.simintero.enstellar.x12.service.X12InboundService;
import com.simintero.enstellar.x12.service.X12InboundService.CanonicalResult;
import com.simintero.enstellar.x12.service.X12OutboundService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/translate")
public class X12TranslateController {

    private final X12InboundService inbound;
    private final X12OutboundService outbound;

    public X12TranslateController(X12InboundService inbound, X12OutboundService outbound) {
        this.inbound = inbound;
        this.outbound = outbound;
    }

    record X12InboundRequest(String rawX12, String tenantId, String tradingPartnerId) {}
    record CanonicalOutboundRequest(Case canonicalCase, String tradingPartnerId) {}

    @PostMapping("/x12-to-canonical")
    public ResponseEntity<Case> x12ToCanonical(@RequestBody X12InboundRequest req) {
        CanonicalResult result = inbound.parseAndStore(req.rawX12(), req.tenantId(), req.tradingPartnerId());
        return ResponseEntity.ok(result.canonicalCase());
    }

    @PostMapping("/canonical-to-x12")
    public ResponseEntity<String> canonicalToX12(@RequestBody CanonicalOutboundRequest req) {
        return ResponseEntity.ok(outbound.caseToX12(req.canonicalCase(), req.tradingPartnerId()));
    }
}
