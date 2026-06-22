package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.opencds.cqf.cql.engine.runtime.Code;
import org.opencds.cqf.cql.engine.terminology.CodeSystemInfo;
import org.opencds.cqf.cql.engine.terminology.TerminologyProvider;
import org.opencds.cqf.cql.engine.terminology.ValueSetInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Resolves value sets from VKAS {@code value_set} artifacts (their seeded {@code expansion.contains})
 * for the CQF engine. Slice 1.2: consumes the flat expansion as-is (no compose traversal / VSAC).
 * Fail-closed: an unresolvable value set or empty expansion THROWS, so callers abstain (indeterminate)
 * rather than treating "couldn't resolve" as "no members".
 */
public class VkasTerminologyProvider implements TerminologyProvider {

    private final VkasClient vkas;
    private final Map<String, List<Code>> cache = new ConcurrentHashMap<>();

    public VkasTerminologyProvider(VkasClient vkas) {
        this.vkas = vkas;
    }

    @Override
    public boolean in(Code code, ValueSetInfo valueSet) {
        for (Code member : expand(valueSet)) {
            if (codesMatch(member, code)) return true;
        }
        return false;
    }

    @Override
    public Iterable<Code> expand(ValueSetInfo valueSet) {
        String url = valueSet.getId();
        return cache.computeIfAbsent(url, u -> {
            JsonNode content = vkas.resolveContent(u, valueSet.getVersion(), RuleContext.empty())
                    .orElseThrow(() -> new IllegalStateException("value set unresolvable: " + u));
            JsonNode contains = content.path("expansion").path("contains");
            if (!contains.isArray() || contains.isEmpty()) {
                throw new IllegalStateException("value set has no expansion.contains: " + u);
            }
            List<Code> codes = new ArrayList<>();
            for (JsonNode c : contains) {
                codes.add(new Code()
                        .withSystem(c.path("system").isMissingNode() ? null : c.path("system").asText())
                        .withCode(c.path("code").asText())
                        .withDisplay(c.path("display").isMissingNode() ? null : c.path("display").asText()));
            }
            return codes;
        });
    }

    @Override
    public Code lookup(Code code, CodeSystemInfo codeSystem) {
        throw new UnsupportedOperationException("CodeSystem $lookup is out of scope for slice 1.2");
    }

    /** Match by code; require system equality only when BOTH sides carry a system. */
    static boolean codesMatch(Code a, Code b) {
        if (a.getCode() == null || !a.getCode().equals(b.getCode())) return false;
        if (a.getSystem() != null && b.getSystem() != null) return a.getSystem().equals(b.getSystem());
        return true;
    }
}
