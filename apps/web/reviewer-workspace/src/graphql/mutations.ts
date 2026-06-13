export const RECORD_DECISION_MUTATION = `
  mutation RecordDecision($input: RecordDecisionInput!) {
    recordDecision(input: $input) {
      determinationId
      error
      errorCode
    }
  }
`;

export const ROUTE_CASE_MUTATION = `
  mutation RouteCase($input: RouteCaseInput!) {
    routeCase(input: $input) {
      taskId
      error
    }
  }
`;
