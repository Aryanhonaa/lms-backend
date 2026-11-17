-- Enrollments created by mistake are marked REMOVED and excluded from rosters, seats and batch metrics.
ALTER TYPE "EnrollmentStatus" ADD VALUE IF NOT EXISTS 'REMOVED';
