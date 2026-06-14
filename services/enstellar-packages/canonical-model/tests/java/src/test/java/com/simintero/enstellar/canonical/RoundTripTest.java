package com.simintero.enstellar.canonical;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class RoundTripTest {

    private static ObjectMapper MAPPER;

    @BeforeAll
    static void setup() {
        MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Member buildMember(String tenantId) {
        // Member(memberId, tenantId, mrn, firstName, lastName, dateOfBirth, gender, identifiers)
        return new Member(
            UUID.fromString("00000000-0000-0000-0000-000000000001"),
            tenantId,
            "MRN-001",
            "Jane",
            "Doe",
            LocalDate.of(1985, 3, 15),
            "F",
            List.of(new Identifier("http://hl7.org/fhir/sid/us-npi", "IDV-001"))
        );
    }

    private static Coverage buildCoverage(String tenantId) {
        // Coverage(coverageId, tenantId, memberId, planId, groupId, subscriberId,
        //          payerName, lob, effectiveDate, terminationDate)
        return new Coverage(
            UUID.fromString("00000000-0000-0000-0000-000000000002"),
            tenantId,
            UUID.fromString("00000000-0000-0000-0000-000000000001"),
            "PLAN-001",
            "GRP-001",
            "SUB-001",
            "Acme Health Plan",
            "commercial",
            LocalDate.of(2026, 1, 1),
            null   // termination_date is optional
        );
    }

    private static Provider buildProvider(String tenantId) {
        // Provider(providerId, tenantId, npi, name, specialty, organizationName, identifiers)
        return new Provider(
            UUID.fromString("00000000-0000-0000-0000-000000000003"),
            tenantId,
            "1234567890",
            "Dr. Alice Smith",
            "Orthopedics",
            "General Hospital",
            null   // identifiers is optional
        );
    }

    private static ServiceLine buildServiceLine(String tenantId) {
        // ServiceLine(serviceLineId, tenantId, sequence, serviceTypeCode, procedureCode,
        //             procedureDescription, quantity, units, diagnosisCodes,
        //             placeOfService, requestedStartDate, requestedEndDate)
        return new ServiceLine(
            UUID.fromString("00000000-0000-0000-0000-000000000004"),
            tenantId,
            1,
            "3",
            "27447",
            "Total knee arthroplasty",
            1.0,
            "UN",
            List.of("M17.11", "M17.12"),
            "21",
            LocalDate.of(2026, 7, 1),
            LocalDate.of(2026, 7, 2)
        );
    }

    private static Case buildCase(String tenantId) {
        // Case(caseId, tenantId, correlationId, lob, program, status, urgency,
        //      member, coverage, requestingProvider, servicingProvider,
        //      serviceLines, decisions, createdAt, updatedAt)
        return new Case(
            UUID.fromString("00000000-0000-0000-0000-000000000010"),
            tenantId,
            "CORR-2026-001",
            "commercial",
            "PA",
            "intake",
            "standard",
            buildMember(tenantId),
            buildCoverage(tenantId),
            buildProvider(tenantId),
            null,   // servicingProvider is optional
            List.of(buildServiceLine(tenantId)),
            null,   // decisions is optional
            Instant.parse("2026-06-05T10:00:00Z"),
            Instant.parse("2026-06-05T10:00:00Z")
        );
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    @Test
    void memberRoundTrip() throws Exception {
        var member = buildMember("tenant-test");
        var json   = MAPPER.writeValueAsString(member);
        var result = MAPPER.readValue(json, Member.class);
        assertEquals(member, result);
    }

    @Test
    void caseRoundTrip() throws Exception {
        var c      = buildCase("tenant-test");
        var json   = MAPPER.writeValueAsString(c);
        var result = MAPPER.readValue(json, Case.class);
        assertEquals(c, result);
    }

    @Test
    void caseJsonContainsTenantId() throws Exception {
        var c    = buildCase("tenant-test");
        var node = MAPPER.readTree(MAPPER.writeValueAsString(c));
        assertEquals("tenant-test", node.get("tenant_id").asText(),
            "top-level tenant_id must be present in JSON");
        assertEquals("tenant-test", node.get("member").get("tenant_id").asText(),
            "member.tenant_id must be present in JSON");
    }
}
