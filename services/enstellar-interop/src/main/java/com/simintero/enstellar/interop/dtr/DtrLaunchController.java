package com.simintero.enstellar.interop.dtr;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * SMART app launch entry for DTR. For the pilot it resolves the launch context and points the
 * caller at the in-house renderer ({@code /dtr}); a real partner DTR app integrates via the
 * standard SMART launch sequence (production path, out of scope here). Reached pre-auth at
 * {@code GET /dtr/launch} (permitAll in SecurityConfig).
 */
@RestController
public class DtrLaunchController {

    @GetMapping("/dtr/launch")
    public Map<String, String> launch(
            @RequestParam(required = false) String iss,
            @RequestParam(required = false) String launch) {
        Map<String, String> ctx = new HashMap<>();
        ctx.put("renderer", "/dtr");
        ctx.put("iss", iss);
        ctx.put("launch", launch);
        return ctx;
    }
}
