# Personal Assistant

This context describes the people and private group boundary served by the personal assistant.

## Language

**Private Group**:
The single private group whose members use the product. It typically has two to six members rather than a hard-coded two-person limit.
_Avoid_: Family, household, tenant

**Member**:
An independently authenticated person who belongs to the private group, has the same product capabilities as every other member, and has their own private data.
_Avoid_: User, account, family member

**Task**:
An actionable commitment derived from a Member's captured content. A Task may have an owner, due information, and private or explicitly shared visibility.
_Avoid_: Todo

**Needs review**:
A state for captured content or an AI interpretation that the assistant could not classify or schedule confidently enough. It must remain visible to the Member for correction or acknowledgment.

**Digest**:
A Member-facing summary of due Tasks, scheduled reminders, and items needing review. New items may appear when they are soon due or in an expandable additional section; an item leaves the digest after the Member actions on or acknowledges it.

**Shared Task**:
A Task whose visibility was explicitly extended to the Private Group. It appears in each Member's digest, particularly when soon due, and any Member may complete it.
