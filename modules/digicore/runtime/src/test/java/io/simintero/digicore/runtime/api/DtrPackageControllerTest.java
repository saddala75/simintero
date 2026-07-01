package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.VkasClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Pure unit test — no Spring context. Controller is instantiated with a Mockito mock.
 */
class DtrPackageControllerTest {

    private VkasClient mockVkasClient;
    private DtrPackageController controller;
    private JsonNode validJson;

    @BeforeEach
    void setUp() throws Exception {
        mockVkasClient = mock(VkasClient.class);
        controller = new DtrPackageController(mockVkasClient);
        validJson = new ObjectMapper().readTree(
                "{\"resourceType\":\"Questionnaire\",\"id\":\"knee-arthroscopy-dtr\"}");
    }

    @Test
    void getPackage_happyPath_returns200WithBody() {
        when(mockVkasClient.resolveContent(
                eq("urn:sim:dtr:knee-arthroscopy:1.0.0"), isNull(), any(RuleContext.class)))
                .thenReturn(Optional.of(validJson));

        ResponseEntity<?> response = controller.getPackage("urn:sim:dtr:knee-arthroscopy:1.0.0");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(validJson);
    }

    @Test
    void getPackage_notFound_returns404() {
        when(mockVkasClient.resolveContent(any(), isNull(), any(RuleContext.class)))
                .thenReturn(Optional.empty());

        ResponseEntity<?> response = controller.getPackage("urn:sim:dtr:unknown:1.0.0");

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void resolvePackage_happyPath_returns200WithBody() {
        when(mockVkasClient.resolveContent(
                eq("urn:sim:dtr:knee-arthroscopy:1.0.0"), isNull(), any(RuleContext.class)))
                .thenReturn(Optional.of(validJson));

        ResponseEntity<?> response = controller.resolvePackage(
                Map.of("dtr_package_ref", "urn:sim:dtr:knee-arthroscopy:1.0.0"));

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(validJson);
    }

    @Test
    void resolvePackage_missingRef_returns400() {
        ResponseEntity<?> response = controller.resolvePackage(Map.of());

        assertThat(response.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void resolvePackage_refNotInVkas_returns404() {
        when(mockVkasClient.resolveContent(any(), isNull(), any(RuleContext.class)))
                .thenReturn(Optional.empty());

        ResponseEntity<?> response = controller.resolvePackage(
                Map.of("dtr_package_ref", "urn:sim:dtr:not-found:1.0.0"));

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }
}
