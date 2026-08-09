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
A Task whose visibility was explicitly extended to the Private Group. It appears in each Member's digest, particularly when soon due, and any Member may complete it. If its owner leaves, the original owner attribution remains and another Member may complete it; reassignment is explicit.

**Invitation**:
A private, single-use request for a person to authenticate their own identity and join the Private Group. An Invitation expires if it is not accepted within its validity period. All Active Members can see and revoke pending Invitations, and any Active Member can create one.

**Active Member**:
A person whose authenticated identity currently belongs to the Private Group. Active Members have equal product capabilities; the person who created the group does not retain a permanent administrative role.

**Removed Member**:
A person whose membership in the Private Group has ended. Their private content remains theirs and is no longer accessible to the group; content they explicitly shared remains shared. Removing another Member requires unanimous confirmation from every unaffected Active Member, while self-removal is always available.

**Identity recovery**:
The deliberate process by which a Member regains access to their existing identity after losing a device or authentication access. The identity remains stable across devices and recovery. Recovery must not grant support or developers access to private content, silently transfer the identity to another person, or automatically merge it with another identity.

**Archived Private Group**:
A Private Group with no Active Members. It accepts no new Invitations and retains its data until an explicit deletion action; leaving and deleting data are separate actions.
