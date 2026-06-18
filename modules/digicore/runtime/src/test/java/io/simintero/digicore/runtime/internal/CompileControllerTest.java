package io.simintero.digicore.runtime.internal;

import io.simintero.digicore.runtime.engine.CqlCompilerService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(CompileController.class)
@Import(CqlCompilerService.class)
class CompileControllerTest {

    @Autowired MockMvc mvc;

    @Test
    void validCqlReturnsElm() throws Exception {
        String body = "{\"cql\":\"library K version '1.0.0'\\nparameter \\\"a\\\" Boolean\\ndefine \\\"D\\\": \\\"a\\\"\"}";
        mvc.perform(post("/internal/compile").contentType("application/json").content(body))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.library.statements.def").isArray())
           .andExpect(jsonPath("$.library.identifier.id").value("K"));
    }

    @Test
    void blankCqlReturns400WithErrors() throws Exception {
        mvc.perform(post("/internal/compile").contentType("application/json").content("{\"cql\":\"\"}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.errors").isArray());
    }

    @Test
    void badCqlReturns400WithErrors() throws Exception {
        String body = "{\"cql\":\"@@@ not cql @@@\"}";
        mvc.perform(post("/internal/compile").contentType("application/json").content(body))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.errors").isArray());
    }
}
