package io.simintero.digicore.runtime.engine;

import org.opencds.cqf.cql.engine.runtime.Code;
import org.opencds.cqf.cql.engine.terminology.CodeSystemInfo;
import org.opencds.cqf.cql.engine.terminology.TerminologyProvider;
import org.opencds.cqf.cql.engine.terminology.ValueSetInfo;

/**
 * Stub {@link TerminologyProvider} installed for slice 1.1.
 *
 * <p>Every operation throws {@link UnsupportedOperationException}. Real value-set membership
 * resolution lands in slice 1.2. If any CQL rule attempts to resolve a value-set code membership
 * check, the engine will propagate this exception, and the evaluator maps it to
 * {@code indeterminate} (abstain — never approve).
 */
public class StubTerminologyProvider implements TerminologyProvider {

    private static final String MESSAGE =
            "Terminology (value-set membership) lands in slice 1.2";

    @Override
    public boolean in(Code code, ValueSetInfo valueSet) {
        throw new UnsupportedOperationException(MESSAGE);
    }

    @Override
    public Iterable<Code> expand(ValueSetInfo valueSet) {
        throw new UnsupportedOperationException(MESSAGE);
    }

    @Override
    public Code lookup(Code code, CodeSystemInfo codeSystem) {
        throw new UnsupportedOperationException(MESSAGE);
    }
}
