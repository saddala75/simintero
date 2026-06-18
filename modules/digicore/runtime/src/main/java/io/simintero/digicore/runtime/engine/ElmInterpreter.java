package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Interprets the bounded ELM subset emitted by parameter-based boolean/comparison CQL.
 *
 * <p>Returns {@code Boolean.TRUE}/{@code Boolean.FALSE} or {@code null}, applying Kleene
 * three-valued logic where {@code null} == "indeterminate". Unknown ELM node types FAIL
 * LOUD via {@link UnsupportedElmException} rather than defaulting to a value.
 *
 * <p>{@code ParameterRef} nodes bind by {@code name} against the supplied evidence map;
 * {@code ExpressionRef} nodes resolve the named definition's {@code expression} from
 * {@code defsByName}.
 */
@Component
public class ElmInterpreter {

    public Object eval(JsonNode expr, Map<String, Object> evidence, Map<String, JsonNode> defsByName) {
        if (expr == null || expr.isNull()) return null;
        String type = expr.path("type").asText();
        return switch (type) {
            case "Null" -> null;
            case "Literal" -> literal(expr);
            case "ParameterRef" -> bindParam(expr.path("name").asText(), evidence);
            case "ExpressionRef" -> {
                JsonNode def = defsByName.get(expr.path("name").asText());
                if (def == null) throw new UnsupportedElmException("ExpressionRef to unknown def: " + expr.path("name").asText());
                yield eval(def.path("expression"), evidence, defsByName);
            }
            case "And" -> kleeneAnd(operandList(expr), evidence, defsByName);
            case "Or" -> kleeneOr(operandList(expr), evidence, defsByName);
            case "Not" -> kleeneNot(eval(expr.path("operand"), evidence, defsByName));
            case "Exists" -> eval(expr.path("operand"), evidence, defsByName) != null;
            case "Equal", "Equivalent" -> eq(expr, evidence, defsByName);
            case "Greater", "GreaterOrEqual", "Less", "LessOrEqual" -> compare(type, expr, evidence, defsByName);
            default -> throw new UnsupportedElmException("Unsupported ELM node type: " + type);
        };
    }

    private Object literal(JsonNode expr) {
        String vt = expr.path("valueType").asText();
        String v = expr.path("value").asText();
        if (vt.endsWith("Boolean")) return Boolean.parseBoolean(v);
        if (vt.endsWith("Integer")) return Long.parseLong(v);
        if (vt.endsWith("Decimal")) return Double.parseDouble(v);
        return v;
    }

    private Object bindParam(String name, Map<String, Object> evidence) {
        if (!evidence.containsKey(name)) return null;
        Object val = evidence.get(name);
        if (val == null) return null;
        if (val instanceof Boolean b) return b;
        if ("indeterminate".equals(val)) return null;
        return val;
    }

    private List<JsonNode> operandList(JsonNode expr) {
        JsonNode ops = expr.path("operand");
        List<JsonNode> list = new ArrayList<>();
        if (ops.isArray()) ops.forEach(list::add); else if (!ops.isMissingNode()) list.add(ops);
        return list;
    }

    private Object kleeneAnd(List<JsonNode> ops, Map<String, Object> ev, Map<String, JsonNode> defs) {
        boolean anyNull = false;
        for (JsonNode o : ops) {
            Object r = eval(o, ev, defs);
            if (Boolean.FALSE.equals(r)) return Boolean.FALSE;
            if (r == null) anyNull = true;
        }
        return anyNull ? null : Boolean.TRUE;
    }

    private Object kleeneOr(List<JsonNode> ops, Map<String, Object> ev, Map<String, JsonNode> defs) {
        boolean anyNull = false;
        for (JsonNode o : ops) {
            Object r = eval(o, ev, defs);
            if (Boolean.TRUE.equals(r)) return Boolean.TRUE;
            if (r == null) anyNull = true;
        }
        return anyNull ? null : Boolean.FALSE;
    }

    private Object kleeneNot(Object r) {
        if (r == null) return null;
        return !((Boolean) r);
    }

    private Object eq(JsonNode expr, Map<String, Object> ev, Map<String, JsonNode> defs) {
        List<JsonNode> ops = operandList(expr);
        Object a = eval(ops.get(0), ev, defs), b = eval(ops.get(1), ev, defs);
        if (a == null || b == null) return null;
        return a.equals(b);
    }

    private Object compare(String type, JsonNode expr, Map<String, Object> ev, Map<String, JsonNode> defs) {
        List<JsonNode> ops = operandList(expr);
        Object a = eval(ops.get(0), ev, defs), b = eval(ops.get(1), ev, defs);
        if (!(a instanceof Number) || !(b instanceof Number)) return null;
        int c = Double.compare(((Number) a).doubleValue(), ((Number) b).doubleValue());
        return switch (type) {
            case "Greater" -> c > 0;
            case "GreaterOrEqual" -> c >= 0;
            case "Less" -> c < 0;
            case "LessOrEqual" -> c <= 0;
            default -> throw new UnsupportedElmException(type);
        };
    }
}
