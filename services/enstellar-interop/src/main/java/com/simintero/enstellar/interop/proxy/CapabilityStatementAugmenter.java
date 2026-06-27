package com.simintero.enstellar.interop.proxy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;

@Component
public class CapabilityStatementAugmenter {

    private static final ObjectMapper JSON = new ObjectMapper();

    public static final List<String> IMPLEMENTATION_GUIDES = List.of(
        "http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core|5.0.1",
        "http://hl7.org/fhir/us/davinci-pas/ImplementationGuide/hl7.fhir.us.davinci-pas|2.0.1",
        "http://hl7.org/fhir/us/davinci-crd/ImplementationGuide/hl7.fhir.us.davinci-crd|2.0.1",
        "http://hl7.org/fhir/us/davinci-dtr/ImplementationGuide/hl7.fhir.us.davinci-dtr|2.0.0"
    );

    public byte[] augment(byte[] capabilityStatementBytes) throws IOException {
        ObjectNode cs = (ObjectNode) JSON.readTree(capabilityStatementBytes);

        cs.put("publisher", "Simintero Enstellar");

        ArrayNode igs = cs.putArray("implementationGuide");
        IMPLEMENTATION_GUIDES.forEach(igs::add);

        // Ensure rest[0].resource exists
        if (cs.withArray("rest").isEmpty()) {
            cs.withArray("rest").addObject().put("mode", "server");
        }
        ArrayNode resources = ((ObjectNode) cs.withArray("rest").get(0)).withArray("resource");

        // Claim with $submit and $inquire operations
        ObjectNode claim = JSON.createObjectNode();
        claim.put("type", "Claim");
        claim.put("profile", "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1");
        claim.putArray("interaction").addObject().put("code", "create");
        ArrayNode claimOps = claim.putArray("operation");
        claimOps.addObject()
            .put("name", "submit")
            .put("definition", "http://hl7.org/fhir/us/davinci-pas/OperationDefinition/Claim-submit");
        claimOps.addObject()
            .put("name", "inquire")
            .put("definition", "http://hl7.org/fhir/us/davinci-pas/OperationDefinition/Claim-inquire");
        resources.add(claim);

        // ClaimResponse
        ObjectNode claimResponse = JSON.createObjectNode();
        claimResponse.put("type", "ClaimResponse");
        claimResponse.put("profile", "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claimresponse-pas|2.0.1");
        claimResponse.putArray("interaction");
        resources.add(claimResponse);

        // Questionnaire
        ObjectNode questionnaire = JSON.createObjectNode();
        questionnaire.put("type", "Questionnaire");
        questionnaire.put("profile", "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaire|2.0.0");
        questionnaire.putArray("interaction").addObject().put("code", "read");
        resources.add(questionnaire);

        // QuestionnaireResponse
        ObjectNode qr = JSON.createObjectNode();
        qr.put("type", "QuestionnaireResponse");
        qr.put("profile", "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/dtr-questionnaireresponse|2.0.0");
        ArrayNode qrInteraction = qr.putArray("interaction");
        qrInteraction.addObject().put("code", "create");
        qrInteraction.addObject().put("code", "read");
        resources.add(qr);

        return JSON.writeValueAsBytes(cs);
    }
}
