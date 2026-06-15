package com.simintero.enstellar.x12.parser;

import java.util.ArrayList;
import java.util.List;

/**
 * Minimal X12 parser — splits raw X12 text into an {@link X12Transaction}.
 *
 * The ISA envelope encodes the element separator (ISA[3]) and the segment
 * terminator (character immediately after the last element of ISA, i.e. position 105).
 * Defaults: element separator = '*', segment terminator = '~'.
 */
public class X12Parser {

    public X12Transaction parse(String rawX12) {
        char elementSeparator = '*';
        char segmentTerminator = '~';

        // ISA is exactly 106 characters; position 3 is the element separator,
        // position 105 is the segment terminator.
        if (rawX12.length() > 105) {
            elementSeparator = rawX12.charAt(3);
            segmentTerminator = rawX12.charAt(105);
        }

        // Split on segment terminator; handle newlines gracefully
        String[] rawSegments = rawX12.split("\\" + segmentTerminator);
        List<X12Segment> segments = new ArrayList<>();

        for (String raw : rawSegments) {
            String trimmed = raw.strip();
            if (trimmed.isEmpty()) continue;

            // Split on element separator keeping trailing empty fields (-1 limit)
            String[] parts = trimmed.split("\\" + elementSeparator, -1);
            String segmentId = parts[0].strip();
            if (segmentId.isEmpty()) continue;

            // elements[0] = segment ID, elements[1..n] = data elements (1-based via getElement)
            List<String> elements = new ArrayList<>(parts.length);
            elements.add(segmentId);
            for (int i = 1; i < parts.length; i++) {
                elements.add(parts[i].strip());
            }
            segments.add(new X12Segment(segmentId, elements));
        }

        return new X12Transaction(segments);
    }
}
