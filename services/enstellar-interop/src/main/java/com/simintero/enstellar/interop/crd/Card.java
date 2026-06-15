package com.simintero.enstellar.interop.crd;

import java.util.List;

/** CDS Hooks 2.0 Card (advisory only — never a determination). */
public record Card(String summary, String indicator, String detail, Source source, List<Link> links) {
    public record Source(String label, String url) {}

    public record Link(String label, String url, String type, String appContext) {}
}
