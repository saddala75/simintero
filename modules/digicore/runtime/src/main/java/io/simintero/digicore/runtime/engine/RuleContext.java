package io.simintero.digicore.runtime.engine;

public record RuleContext(String lob, String region, String program, String product) {
    public static RuleContext empty() {
        return new RuleContext(null, null, null, null);
    }
}
