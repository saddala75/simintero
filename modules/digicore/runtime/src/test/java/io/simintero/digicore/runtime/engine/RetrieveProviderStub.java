package io.simintero.digicore.runtime.engine;

import org.opencds.cqf.cql.engine.retrieve.RetrieveProvider;
import org.opencds.cqf.cql.engine.runtime.Code;
import org.opencds.cqf.cql.engine.runtime.Interval;

import java.util.List;
import java.util.function.Function;

/**
 * Test fake {@link RetrieveProvider} that delegates to a {@code Function<String,List<Object>>}
 * keyed by the {@code dataType} (4th retrieve argument), so tests can drive the CQF engine
 * without a database. The supplied function may also throw, to exercise the abstain path.
 */
final class RetrieveProviderStub implements RetrieveProvider {

    private final Function<String, List<Object>> byDataType;

    RetrieveProviderStub(Function<String, List<Object>> byDataType) {
        this.byDataType = byDataType;
    }

    @Override
    public Iterable<Object> retrieve(String context, String contextPath, Object contextValue,
                                     String dataType, String templateId, String codePath,
                                     Iterable<Code> codes, String valueSet,
                                     String datePath, String dateLowPath, String dateHighPath,
                                     Interval dateRange) {
        return byDataType.apply(dataType);
    }
}
