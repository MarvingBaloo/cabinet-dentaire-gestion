-- CreateIndex
CREATE INDEX "audit_log_ip_address_occurred_at_idx" ON "audit_log"("ip_address", "occurred_at");
