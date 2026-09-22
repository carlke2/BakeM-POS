import prisma from '@/services/prisma';

interface AuditEventInput {
  eventType: string;
  userType: string;
  userId?: string;
  userName: string;
  userEmail?: string;
  action: string;
  description?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export const logAuditEvent = async (input: AuditEventInput): Promise<void> => {
  try {
    await prisma.auditEvent.create({
      data: {
        eventType: input.eventType,
        userType: input.userType,
        userId: input.userId,
        userName: input.userName,
        userEmail: input.userEmail,
        action: input.action,
        description: input.description,
        metadata: input.metadata as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  } catch (err) {
    // Never crash the main request due to audit failure
    console.error('Audit log error:', err);
  }
};
