package com.simintero.enstellar.interop.crd;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Maps Digicore coverage content to CDS Hooks advisory cards. Pure function — no determination
 * is ever made here; cards only inform the ordering provider.
 */
@Component
public class CrdCardMapper {

    private static final String RULE_BASE = "https://enstellar.simintero.com/crd-rule/";

    public List<Card> toCards(CrdContent content, String serviceCode) {
        var source = new Card.Source("Enstellar CRD", RULE_BASE + content.ruleReference());
        List<Card> cards = new ArrayList<>();

        if (!content.paRequired()) {
            cards.add(new Card(
                    "Prior authorization not required for " + serviceCode,
                    "info",
                    "Coverage rule " + content.ruleReference() + " indicates no PA is required.",
                    source,
                    null));
            return cards;
        }

        List<Card.Link> launch = content.dtrLaunchUrl() == null
                ? null
                : List.of(new Card.Link("Complete documentation (DTR)", content.dtrLaunchUrl(),
                        "smart", serviceCode));
        cards.add(new Card(
                "Prior authorization required for " + serviceCode,
                "warning",
                "This service requires prior authorization. Launch DTR to complete documentation.",
                source,
                launch));

        if (content.documentationRequirements() != null && !content.documentationRequirements().isEmpty()) {
            cards.add(new Card(
                    "Documentation requirements",
                    "info",
                    "Required: " + String.join(", ", content.documentationRequirements()),
                    source,
                    null));
        }
        return cards;
    }
}
