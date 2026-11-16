## Summary

<!-- Explain what changed and why. -->

## Related Work

- Related Issue: <!-- Example: Closes #123 -->
- Requirement ID: <!-- If applicable -->
- Working branch: <!-- feature/123-short-description -->

## Changes

- 
- 

## Test Results

### Executed

- [ ] Build passed
- [ ] Lint or static analysis passed
- [ ] Unit tests passed
- [ ] Integration tests passed, if applicable
- [ ] Secret scan passed
- [ ] Security or dependency checks passed, if applicable

Commands or workflow references:

```text
<!-- Record the commands or CI workflow links/references. Do not include secrets. -->
```

### Not Executed

<!-- List tests not executed and explain why. Write "None" if all applicable checks ran. -->

## Impact Assessment

- Existing behavior affected:
- Public API or interface changes:
- Configuration or migration required:
- Operational impact:
- Rollback approach:

## Security Review

- [ ] No secrets, tokens, passwords, private keys, or production connection strings are included
- [ ] Authentication and authorization impacts were reviewed
- [ ] Input validation and error handling were reviewed
- [ ] Logs do not expose secrets, personal data, or sensitive values
- [ ] New dependencies are necessary and reviewed
- [ ] Least-privilege requirements are maintained

Security notes:

<!-- Describe security impact. Write "No material security impact" when appropriate. -->

## AI Agent Usage

- [ ] No AI agent was used
- [ ] An AI agent assisted with analysis, implementation, tests, documentation, or review

AI tools and scope:

<!-- Example: Claude Code generated the initial implementation and tests. A human reviewed the complete diff. -->

## Author Checklist

### Development start

- [ ] The work is linked to an Issue or qualifies for the documented minor-change exception
- [ ] Requirements and acceptance criteria were confirmed
- [ ] The branch was created from the latest `develop`
- [ ] The branch follows the repository naming convention

### Implementation

- [ ] Changes remain within the approved scope
- [ ] Unrelated refactoring is not included
- [ ] Tests were added or updated for changed behavior
- [ ] Documentation was updated where required
- [ ] No temporary or debug files are included
- [ ] No secret or sensitive data is committed

### Pull Request readiness

- [ ] The base branch is `develop`, except for an approved release or hotfix
- [ ] The diff contains no unintended changes
- [ ] All applicable local checks passed
- [ ] Known limitations and follow-up work are documented
- [ ] The Pull Request is small enough for effective review

## Reviewer Checklist

### Requirements and quality

- [ ] The implementation satisfies the Issue and acceptance criteria
- [ ] Requirement IDs are traceable when applicable
- [ ] The code is understandable and consistent with repository conventions
- [ ] Error handling and boundary cases are appropriate
- [ ] Tests meaningfully validate the changed behavior

### Security and operations

- [ ] Authentication and authorization are appropriate
- [ ] No secrets or sensitive information are exposed
- [ ] Dependency changes are justified
- [ ] Deployment, compatibility, and rollback impacts are acceptable
- [ ] Required owners reviewed critical files

### AI-generated changes

- [ ] The actual diff was reviewed rather than relying on the AI summary
- [ ] AI-generated tests were checked for correct assertions and meaningful coverage
- [ ] No unrequested feature, dependency, or architectural change was introduced
- [ ] The AI agent is not the final approval authority

## Merge Gate

The Pull Request may be merged only when all applicable conditions are met:

- [ ] Required CI and status checks passed
- [ ] Required approvals were received
- [ ] Required `CODEOWNERS` approval was received
- [ ] All review conversations were resolved
- [ ] No blocking security or quality issue remains
- [ ] Acceptance criteria are satisfied
- [ ] A human or independent authorized approver completed the final review
