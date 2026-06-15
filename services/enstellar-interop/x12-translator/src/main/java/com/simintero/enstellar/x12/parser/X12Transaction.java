package com.simintero.enstellar.x12.parser;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * A parsed X12 transaction — an ordered list of segments with helper methods
 * for locating segments by ID or by HL loop type.
 */
public class X12Transaction {

    private final List<X12Segment> segments;

    public X12Transaction(List<X12Segment> segments) {
        this.segments = List.copyOf(segments);
    }

    public List<X12Segment> getSegments() {
        return segments;
    }

    /** Find the first segment with the given segment ID anywhere in the transaction. */
    public Optional<X12Segment> findSegment(String segmentId) {
        return segments.stream()
                .filter(s -> s.segmentId().equals(segmentId))
                .findFirst();
    }

    /**
     * Find the first matching segment within the named HL loop.
     *
     * loopId values and their HL level codes (element 3 of the HL segment):
     *   "2000A" -> "20"  (utilization management organization / payer)
     *   "2000B" -> "21"  (requesting provider)
     *   "2000C" -> "22"  (subscriber / member)
     *   "2000D" -> "23"  (dependent)
     *   "2000E" -> "EV"  (event / service)
     */
    public Optional<X12Segment> findSegmentInLoop(String loopId, String segmentId) {
        return findAllSegmentsInLoop(loopId, segmentId).stream().findFirst();
    }

    /**
     * Find all segments with the given segment ID within the named HL loop.
     * "In loop" means: after the HL segment that opens the loop, and before
     * the next HL segment that opens a loop of the same or a parent level.
     * For simplicity this implementation collects every occurrence inside any
     * sub-section that starts with the matching HL level code.
     */
    public List<X12Segment> findAllSegmentsInLoop(String loopId, String segmentId) {
        String hlCode = switch (loopId) {
            case "2000A" -> "20";
            case "2000B" -> "21";
            case "2000C" -> "22";
            case "2000D" -> "23";
            case "2000E" -> "EV";
            default -> loopId;
        };

        List<X12Segment> result = new ArrayList<>();
        boolean inLoop = false;
        for (X12Segment seg : segments) {
            if (seg.segmentId().equals("HL")) {
                // HL element 3 is the level code
                inLoop = seg.getElement(3).equals(hlCode);
            }
            if (inLoop && seg.segmentId().equals(segmentId)) {
                result.add(seg);
            }
        }
        return result;
    }
}
