package com.simintero.enstellar.interop.proxy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TenantTagUtilTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void injectTag_adds_security_tag_to_resource_without_meta() throws Exception {
        byte[] body = """
            {"resourceType":"Patient","id":"p1"}
            """.getBytes();

        byte[] result = TenantTagUtil.injectTenantTag(body, "acme");

        var root = JSON.readTree(result);
        ArrayNode security = (ArrayNode) root.path("meta").path("security");
        assertThat(security).hasSize(1);
        assertThat(security.get(0).path("system").asText())
            .isEqualTo("https://enstellar.simintero.com/tenants");
        assertThat(security.get(0).path("code").asText()).isEqualTo("acme");
    }

    @Test
    void injectTag_appends_to_existing_security_tags() throws Exception {
        byte[] body = """
            {"resourceType":"Patient","meta":{"security":[{"system":"http://existing","code":"x"}]}}
            """.getBytes();

        byte[] result = TenantTagUtil.injectTenantTag(body, "beta");

        var root = JSON.readTree(result);
        ArrayNode security = (ArrayNode) root.path("meta").path("security");
        assertThat(security).hasSize(2);
        assertThat(security.get(1).path("code").asText()).isEqualTo("beta");
    }

    @Test
    void injectTag_is_idempotent_does_not_duplicate() throws Exception {
        byte[] body = """
            {"resourceType":"Patient","meta":{"security":[
              {"system":"https://enstellar.simintero.com/tenants","code":"acme"}
            ]}}
            """.getBytes();

        byte[] result = TenantTagUtil.injectTenantTag(body, "acme");

        var root = JSON.readTree(result);
        ArrayNode security = (ArrayNode) root.path("meta").path("security");
        assertThat(security).hasSize(1);
    }

    @Test
    void hasTenantTag_true_when_tag_present() throws Exception {
        byte[] body = """
            {"resourceType":"Patient","meta":{"security":[
              {"system":"https://enstellar.simintero.com/tenants","code":"acme"}
            ]}}
            """.getBytes();

        assertThat(TenantTagUtil.hasTenantTag(body, "acme")).isTrue();
    }

    @Test
    void hasTenantTag_false_when_tag_absent() throws Exception {
        byte[] body = """
            {"resourceType":"Patient"}
            """.getBytes();

        assertThat(TenantTagUtil.hasTenantTag(body, "acme")).isFalse();
    }

    @Test
    void hasTenantTag_false_when_wrong_tenant() throws Exception {
        byte[] body = """
            {"resourceType":"Patient","meta":{"security":[
              {"system":"https://enstellar.simintero.com/tenants","code":"other"}
            ]}}
            """.getBytes();

        assertThat(TenantTagUtil.hasTenantTag(body, "acme")).isFalse();
    }
}
