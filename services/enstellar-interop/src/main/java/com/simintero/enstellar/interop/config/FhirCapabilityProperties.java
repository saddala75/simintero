package com.simintero.enstellar.interop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
@ConfigurationProperties(prefix = "enstellar.fhir.capability")
public class FhirCapabilityProperties {

    private String publisher = "Simintero Enstellar";
    private List<ResourceConfig> resources = new ArrayList<>();

    public String getPublisher() { return publisher; }
    public void setPublisher(String p) { this.publisher = p; }
    public List<ResourceConfig> getResources() { return resources; }
    public void setResources(List<ResourceConfig> r) { this.resources = r; }

    public static class ResourceConfig {
        private String type;
        private String profile = "";
        private List<String> interactions = new ArrayList<>();

        public String getType() { return type; }
        public void setType(String t) { this.type = t; }
        public String getProfile() { return profile; }
        public void setProfile(String p) { this.profile = p; }
        public List<String> getInteractions() { return interactions; }
        public void setInteractions(List<String> i) { this.interactions = i; }
    }
}
