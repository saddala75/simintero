package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ElmInterpreterTest {
    private final ObjectMapper m = new ObjectMapper();
    private final ElmInterpreter interp = new ElmInterpreter();
    private JsonNode n(String json) throws Exception { return m.readTree(json); }

    private Object evalParam(Object evidenceVal) throws Exception {
        Map<String,Object> ev = new HashMap<>(); ev.put("p", evidenceVal);
        return interp.eval(n("{\"type\":\"ParameterRef\",\"name\":\"p\"}"), ev, Map.of());
    }

    @Test void parameterRefBindsBoolean() throws Exception {
        assertEquals(Boolean.TRUE, evalParam(true));
        assertEquals(Boolean.FALSE, evalParam(false));
    }
    @Test void parameterRefUnknownIsNull() throws Exception {
        assertNull(evalParam(null));
        assertNull(evalParam("indeterminate"));
        assertNull(interp.eval(n("{\"type\":\"ParameterRef\",\"name\":\"p\"}"), new HashMap<>(), Map.of()));
    }
    @Test void kleeneAnd() throws Exception {
        assertEquals(Boolean.FALSE, and(false, null));
        assertNull(and(true, null));
        assertEquals(Boolean.TRUE, and(true, true));
        assertEquals(Boolean.FALSE, and(true, false));
    }
    @Test void kleeneOr() throws Exception {
        assertEquals(Boolean.TRUE, or(true, null));
        assertNull(or(false, null));
        assertEquals(Boolean.FALSE, or(false, false));
        assertEquals(Boolean.TRUE, or(false, true));
    }
    @Test void kleeneNot() throws Exception {
        assertEquals(Boolean.FALSE, not(true));
        assertEquals(Boolean.TRUE, not(false));
        assertNull(not(null));
    }
    @Test void literalBoolean() throws Exception {
        assertEquals(Boolean.TRUE, interp.eval(
            n("{\"type\":\"Literal\",\"valueType\":\"{urn:hl7-org:elm-types:r1}Boolean\",\"value\":\"true\"}"),
            Map.of(), Map.of()));
        assertEquals(Boolean.FALSE, interp.eval(
            n("{\"type\":\"Literal\",\"valueType\":\"{urn:hl7-org:elm-types:r1}Boolean\",\"value\":\"false\"}"),
            Map.of(), Map.of()));
    }
    @Test void existsIsTrueWhenNonNull() throws Exception {
        Map<String,Object> ev = new HashMap<>(); ev.put("p", true);
        assertEquals(Boolean.TRUE, interp.eval(
            n("{\"type\":\"Exists\",\"operand\":{\"type\":\"ParameterRef\",\"name\":\"p\"}}"), ev, Map.of()));
        ev.put("p", null);
        assertEquals(Boolean.FALSE, interp.eval(
            n("{\"type\":\"Exists\",\"operand\":{\"type\":\"ParameterRef\",\"name\":\"p\"}}"), ev, Map.of()));
    }
    @Test void expressionRefResolvesDef() throws Exception {
        Map<String,JsonNode> defs = new HashMap<>();
        defs.put("Leaf", n("{\"name\":\"Leaf\",\"expression\":{\"type\":\"ParameterRef\",\"name\":\"p\"}}"));
        Map<String,Object> ev = new HashMap<>(); ev.put("p", true);
        assertEquals(Boolean.TRUE, interp.eval(n("{\"type\":\"ExpressionRef\",\"name\":\"Leaf\"}"), ev, defs));
    }
    @Test void greaterComparison() throws Exception {
        // Greater(5, 3) → true ; uses Literal Integers
        assertEquals(Boolean.TRUE, interp.eval(n(
          "{\"type\":\"Greater\",\"operand\":[" +
          "{\"type\":\"Literal\",\"valueType\":\"{urn:hl7-org:elm-types:r1}Integer\",\"value\":\"5\"}," +
          "{\"type\":\"Literal\",\"valueType\":\"{urn:hl7-org:elm-types:r1}Integer\",\"value\":\"3\"}]}"),
          Map.of(), Map.of()));
    }
    @Test void unknownNodeThrows() {
        assertThrows(UnsupportedElmException.class, () -> {
            try { interp.eval(n("{\"type\":\"SomeFutureOp\"}"), Map.of(), Map.of()); }
            catch (Exception e) { if (e instanceof UnsupportedElmException) throw e; throw new RuntimeException(e); }
        });
    }

    // helpers building binary And/Or and unary Not over Literal/Null nodes
    private Object and(Object a, Object b) throws Exception { return binary("And", a, b); }
    private Object or(Object a, Object b) throws Exception { return binary("Or", a, b); }
    private Object not(Object a) throws Exception {
        return interp.eval(n("{\"type\":\"Not\",\"operand\":" + lit(a) + "}"), Map.of(), Map.of());
    }
    private Object binary(String type, Object a, Object b) throws Exception {
        return interp.eval(n("{\"type\":\"" + type + "\",\"operand\":[" + lit(a) + "," + lit(b) + "]}"), Map.of(), Map.of());
    }
    private String lit(Object v) {
        if (v == null) return "{\"type\":\"Null\"}";
        return "{\"type\":\"Literal\",\"valueType\":\"{urn:hl7-org:elm-types:r1}Boolean\",\"value\":\"" + v + "\"}";
    }
}
