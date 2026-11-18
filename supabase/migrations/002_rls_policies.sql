-- ============================================================================
-- VERTEXT SAAS: MULTI-TENANT SCRCPY CLOUD DEVICE MANAGEMENT PLATFORM
-- Migration 002: Row Level Security (RLS) Policies
-- ============================================================================

-- Helper functions to extract authenticated user claims
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS UUID AS $$
    SELECT auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND system_role = 'admin'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF UUID AS $$
    SELECT organization_id FROM public.organization_members
    WHERE user_id = auth.uid()
    UNION
    SELECT id FROM public.organizations
    WHERE owner_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Enable RLS on all sensitive tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloudflare_tunnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assigned_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- PROFILES POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can read their own profile"
    ON public.profiles FOR SELECT
    USING (id = auth.uid() OR public.is_platform_admin());

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- ----------------------------------------------------------------------------
-- ORGANIZATIONS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Members or admins can view their organizations"
    ON public.organizations FOR SELECT
    USING (
        id IN (SELECT public.user_org_ids())
        OR public.is_platform_admin()
    );

CREATE POLICY "Owners can update their organization"
    ON public.organizations FOR UPDATE
    USING (owner_id = auth.uid() OR public.is_platform_admin());

-- ----------------------------------------------------------------------------
-- ORGANIZATION MEMBERS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Members can view members in their org"
    ON public.organization_members FOR SELECT
    USING (organization_id IN (SELECT public.user_org_ids()) OR public.is_platform_admin());

CREATE POLICY "Owners can manage members in their org"
    ON public.organization_members FOR ALL
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

-- ----------------------------------------------------------------------------
-- AGENTS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Org members can view agents"
    ON public.agents FOR SELECT
    USING (organization_id IN (SELECT public.user_org_ids()) OR public.is_platform_admin());

CREATE POLICY "Org owners/admins can update or delete agents"
    ON public.agents FOR ALL
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

-- ----------------------------------------------------------------------------
-- AGENT ENROLLMENT TOKENS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Org owners can manage enrollment tokens"
    ON public.agent_enrollment_tokens FOR ALL
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

-- ----------------------------------------------------------------------------
-- DEVICES POLICIES (TENANT ISOLATION + ASSIGNED USERS RESTRICTION)
-- ----------------------------------------------------------------------------
CREATE POLICY "Device access policy"
    ON public.devices FOR SELECT
    USING (
        -- Platform Admin
        public.is_platform_admin()
        OR
        -- Device Owner / Org Member
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR
        -- Subordinate Assigned User (Can see ONLY explicitly assigned devices)
        id IN (
            SELECT device_id FROM public.device_assignments
            WHERE assigned_user_id = auth.uid() AND can_view = TRUE
        )
    );

CREATE POLICY "Device modification policy"
    ON public.devices FOR UPDATE
    USING (
        public.is_platform_admin()
        OR
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
    );

CREATE POLICY "Device deletion policy"
    ON public.devices FOR DELETE
    USING (
        public.is_platform_admin()
        OR
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
    );

-- ----------------------------------------------------------------------------
-- DEVICE SHARES POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Owners can manage device shares"
    ON public.device_shares FOR ALL
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

-- ----------------------------------------------------------------------------
-- ASSIGNED USERS & DEVICE ASSIGNMENTS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Owners can manage assigned users"
    ON public.assigned_users FOR ALL
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

CREATE POLICY "Users can view their own assignment entry"
    ON public.assigned_users FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Owners can manage device assignments"
    ON public.device_assignments FOR ALL
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

CREATE POLICY "Assigned users can view their specific device assignments"
    ON public.device_assignments FOR SELECT
    USING (assigned_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- AUDIT LOGS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Org owners can view audit logs"
    ON public.audit_logs FOR SELECT
    USING (
        organization_id IN (SELECT id FROM public.organizations WHERE owner_id = auth.uid())
        OR public.is_platform_admin()
    );

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view and update their notifications"
    ON public.notifications FOR ALL
    USING (user_id = auth.uid() OR public.is_platform_admin());
