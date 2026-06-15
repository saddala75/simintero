package com.simintero.enstellar.x12.parser;

import java.util.List;

/**
 * A single parsed X12 segment.
 * elements[0] is always the segment ID; data elements start at index 1.
 * getElement(n) uses 1-based X12 notation: element 1 is the first data element after the segment ID.
 */
public record X12Segment(String segmentId, List<String> elements) {

    /**
     * 1-based element access matching X12 spec notation.
     * element 1 = first data element after segment ID.
     * Returns empty string if position is out of range.
     */
    public String getElement(int position) {
        if (position < 1 || position >= elements.size()) return "";
        return elements.get(position);
    }
}
