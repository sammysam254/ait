-- ============================================================================
-- VERTEXT SAAS: MULTI-TENANT SCRCPY CLOUD DEVICE MANAGEMENT PLATFORM
-- Seed Data for Development and Testing
-- ============================================================================

-- Platform Admin UUID: 11111111-1111-1111-1111-111111111111
-- Customer A UUID:     22222222-2222-2222-2222-222222222222
-- Customer B UUID:     33333333-3333-3333-3333-333333333333
-- Assigned User UUID:  44444444-4444-4444-4444-444444444444

-- Seed Profiles
INSERT INTO public.profiles (id, email, full_name, system_role)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'admin@vertex-saas.local', 'Platform Super Admin', 'admin'),
    ('22222222-2222-2222-2222-222222222222', 'customerA@enterprise.local', 'Customer A (Dev Operations)', 'customer'),
    ('33333333-3333-3333-3333-333333333333', 'customerB@fintech.local', 'Customer B (QA Testing Lab)', 'customer'),
    ('44444444-4444-4444-4444-444444444444', 'assigned.user@partner.local', 'Subordinate Tester John', 'assigned_user')
ON CONFLICT (id) DO NOTHING;

-- Seed Organizations
INSERT INTO public.organizations (id, name, slug, owner_id, plan, max_devices, max_agents)
VALUES
    ('aaaa0000-0000-0000-0000-000000000001', 'Customer A Lab', 'customer-a-lab', '22222222-2222-2222-2222-222222222222', 'pro', 20, 5),
    ('bbbb0000-0000-0000-0000-000000000002', 'Customer B Testing Farm', 'customer-b-farm', '33333333-3333-3333-3333-333333333333', 'starter', 5, 2)
ON CONFLICT (id) DO NOTHING;

-- Seed Org Members
INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES
    ('aaaa0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'owner'),
    ('bbbb0000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'owner'),
    ('aaaa0000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'member')
ON CONFLICT DO NOTHING;

-- Seed Windows Agents
INSERT INTO public.agents (id, organization_id, computer_name, os_version, arch, agent_version, ip_address, status, auth_token_hash, last_heartbeat)
VALUES
    ('agent001-aaaa-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'WIN-HOST-OFFICE-01', 'Windows 11 Pro 24H2', 'x64', '1.0.0', '192.168.1.105', 'online', 'hash_agent_token_sample_1', NOW()),
    ('agent002-bbbb-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000002', 'QA-RIG-DESKTOP-04', 'Windows 10 Enterprise', 'x64', '1.0.0', '10.0.0.45', 'online', 'hash_agent_token_sample_2', NOW())
ON CONFLICT (id) DO NOTHING;

-- Seed Devices
INSERT INTO public.devices (id, organization_id, agent_id, adb_serial, device_name, model, manufacturer, android_version, sdk_version, screen_width, screen_height, screen_density, connection_type, status, last_seen)
VALUES
    -- Customer A's devices
    ('dev00001-aaaa-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'agent001-aaaa-0000-0000-000000000001', 'R5CN80ABC1D', 'Samsung Galaxy S23 Ultra', 'SM-S918B', 'Samsung', '14', 34, 1440, 3088, 500, 'usb', 'online', NOW()),
    ('dev00002-aaaa-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000001', 'agent001-aaaa-0000-0000-000000000001', '192.168.1.150:5555', 'Google Pixel 8 Pro', 'Pixel 8 Pro', 'Google', '14', 34, 1344, 2992, 480, 'wifi', 'online', NOW()),
    
    -- Customer B's device (completely isolated from Customer A)
    ('dev00003-bbbb-0000-0000-000000000003', 'bbbb0000-0000-0000-0000-000000000002', 'agent002-bbbb-0000-0000-000000000002', 'ZY3223GTR5', 'Motorola Edge 50 Pro', 'XT2403-1', 'Motorola', '14', 34, 1220, 2712, 446, 'usb', 'online', NOW())
ON CONFLICT (id) DO NOTHING;

-- Seed Assigned User mapping for Customer A
INSERT INTO public.assigned_users (id, organization_id, user_id, invited_by, status)
VALUES
    ('assign01-aaaa-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'active')
ON CONFLICT (id) DO NOTHING;

-- Assign Customer A's Device 1 to Subordinate Assigned User (Can view and control Device 1, but cannot see Device 2)
INSERT INTO public.device_assignments (id, organization_id, device_id, assigned_user_id, can_view, can_control, can_share, assigned_by)
VALUES
    ('da000001-aaaa-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'dev00001-aaaa-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', TRUE, TRUE, FALSE, '22222222-2222-2222-2222-222222222222')
ON CONFLICT (device_id, assigned_user_id) DO NOTHING;

-- Seed Sample Share Link (PIN: '849201')
INSERT INTO public.device_shares (id, organization_id, device_id, share_token, pin_hash, pin_preview, allow_control, expires_at, max_uses, current_uses, is_revoked, created_by)
VALUES
    ('share001-aaaa-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'dev00001-aaaa-0000-0000-000000000001', 'vtx_demo_share_token_8842', '$2a$10$e7QhK6uEom8U7K1WpT1eEOtL8rC5oZ3m9i2s1k5j3o9u4n7x9p4v.', '849201', TRUE, NOW() + INTERVAL '7 days', 25, 1, FALSE, '22222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;
