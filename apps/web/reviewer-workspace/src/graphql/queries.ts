export const WORKLIST_QUERY = `
  query GetWorklist($state: String, $lob: String, $after: String) {
    worklist(state: $state, lob: $lob, after: $after) {
      items {
        case_id
        urgency
        state
        member_ref
        lob
        clock { state deadline }
      }
      nextCursor
    }
  }
`;

export const CASE_DETAIL_QUERY = `
  query GetCaseDetail($caseId: ID!) {
    case(caseId: $caseId) {
      case_id
      urgency
      state
      member_ref
      lob
      service_lines { line_id code { code system } qty status place_of_service }
    }
  }
`;

export const TRACE_QUERY = `
  query GetTrace($traceRef: String!) {
    trace(traceRef: $traceRef) {
      criteria {
        expression_name
        result
        artifact_canonical_url
        artifact_version
      }
    }
  }
`;
