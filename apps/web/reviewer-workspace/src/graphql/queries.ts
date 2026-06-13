export const WORKLIST_QUERY = `
  query GetWorklist($state: String, $lob: String, $after: String) {
    worklist(state: $state, lob: $lob, after: $after) {
      edges {
        node {
          caseId
          urgency
          state
          memberRef
          lob
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

export const CASE_DETAIL_QUERY = `
  query GetCaseDetail($caseId: ID!) {
    case(caseId: $caseId) {
      caseId
      urgency
      state
      memberRef
      lob
      channel
      serviceLines {
        lineId
        code
        qty
        status
      }
    }
  }
`;

export const TRACE_QUERY = `
  query GetTrace($traceRef: String!) {
    trace(traceRef: $traceRef) {
      traceRef
      rules
      raw
    }
  }
`;

export const ADVISORY_QUERY = `
  query GetAdvisory($caseId: ID!) {
    advisory(caseId: $caseId) {
      status
      analysis_id
      result {
        summary {
          status
          assertions {
            id
            text
            confidence
            citations { documentRef page }
          }
        }
        triage {
          status
          suggestion
          confidence
        }
      }
    }
  }
`;
