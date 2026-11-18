-- ============================================================================
-- VERTEXT SAAS: MULTI-TENANT SCRCPY CLOUD DEVICE MANAGEMENT PLATFORM
-- Migration 003: Functions, Triggers, and Stored Procedures
-- ============================================================================

-- 1. Automatic Timestamp Updater
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger across relevant tables
DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_organizations_updated_at ON public.organizations;
CREATE TRIGGER set_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_agents_updated_at ON public.agents;
CREATE TRIGGER set_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_devices_updated_at ON public.devices;
CREATE TRIGGER set_devices_updated_at BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_device_shares_updated_at ON public.device_shares;
CREATE TRIGGER set_device_shares_updated_at BEFORE UPDATE ON public.device_shares FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_device_assignments_updated_at ON public.device_assignments;
CREATE TRIGGER set_device_assignments_updated_at BEFORE UPDATE ON public.device_assignments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. New User Signup Handler (Creates Profile & Default Organization automatically)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
    user_name TEXT;
    org_slug TEXT;
    assigned_role TEXT;
BEGIN
    user_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
    org_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6);

    -- Designate Super Admin for sammyseth260@gmail.com
    IF lower(NEW.email) = 'sammyseth260@gmail.com' THEN
        assigned_role := 'admin';
    ELSE
        assigned_role := COALESCE(NEW.raw_user_meta_data->>'system_role', 'customer');
    END IF;

    -- Insert Profile
    INSERT INTO public.profiles (id, email, full_name, system_role)
    VALUES (
        NEW.id,
        NEW.email,
        user_name,
        assigned_role
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, 
        full_name = EXCLUDED.full_name,
        system_role = assigned_role;

    -- Create Organization
    INSERT INTO public.organizations (name, slug, owner_id, plan, max_devices, max_agents)
    VALUES (
        user_name || '''s Cloud Devices',
        org_slug,
        NEW.id,
        CASE WHEN assigned_role = 'admin' THEN 'enterprise' ELSE 'starter' END,
        CASE WHEN assigned_role = 'admin' THEN 100 ELSE 5 END,
        CASE WHEN assigned_role = 'admin' THEN 20 ELSE 3 END
    )
    RETURNING id INTO new_org_id;

    -- Add as owner in organization_members
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');

    -- Create a welcome notification
    INSERT INTO public.notifications (organization_id, user_id, title, message, type)
    VALUES (
        new_org_id,
        NEW.id,
        'Welcome to Vertex SaaS',
        CASE 
            WHEN assigned_role = 'admin' THEN 'Platform Super Admin clearance granted. You have unrestricted access across all tenants and device farms.'
            ELSE 'Your device farm cloud dashboard is ready. Download your personalized Windows setup script to connect your Android phones.'
        END,
        'info'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach to auth.users if available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    END IF;
END $$;
