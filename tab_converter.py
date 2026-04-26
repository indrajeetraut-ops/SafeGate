import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Update the Admin Dashboard Header to include the Tabs Nav
tabs_html = """
            <nav class="admin-tabs px-4">
                <div class="admin-tab active" onclick="app.switchAdminTab('students')" id="nav-tab-students">Students</div>
                <div class="admin-tab" onclick="app.switchAdminTab('gatekeepers')" id="nav-tab-gatekeepers">Gatekeepers</div>
                <div class="admin-tab" onclick="app.switchAdminTab('parents')" id="nav-tab-parents">Parents</div>
                <div class="admin-tab" onclick="app.switchAdminTab('id-design')" id="nav-tab-id-design">ID Design</div>
                <div class="admin-tab" onclick="app.switchAdminTab('generate-id')" id="nav-tab-generate-id">Generate ID</div>
            </nav>
            <main class="content pad-content" style="padding-top: 1rem;">
                <div id="tab-students" class="admin-tab-pane active">
"""
html = html.replace('<main class="content pad-content">', tabs_html, 1)

# Remove the old buttons
old_toolbar_buttons = """<button class="btn btn-primary btn-sm" onclick="app.showManageGatekeepers()"><i
                                    class="fa-solid fa-user-shield"></i> Gatekeepers</button>
                            <button class="btn btn-tertiary btn-sm" onclick="app.showIDTemplates()"><i
                                    class="fa-solid fa-id-card"></i> ID Cards</button>
                            <button class="btn btn-secondary btn-sm" onclick="app.showGenerateIDCard()"><i
                                    class="fa-solid fa-address-card"></i> Generate ID</button>
                            <button class="btn btn-tertiary btn-sm" onclick="app.showManageParents()"><i
                                    class="fa-solid fa-users"></i> Parents</button>"""
html = html.replace(old_toolbar_buttons, '')

# Close the tab-students div where admin-view used to end
html = html.replace('</section>\n\n        <!-- Parent View -->', '</div>\n\n        <!-- End tab-students -->\n', 1)

views_to_embed = [
    ('id-templates-view', 'tab-id-design'),
    ('generate-id-view', 'tab-generate-id'),
    ('parents-view', 'tab-parents'),
    ('gatekeepers-view', 'tab-gatekeepers')
]

for view_id, tab_id in views_to_embed:
    pattern = rf'<section id="{view_id}" class="screen">(.*?)</section>'
    match = re.search(pattern, html, re.DOTALL)
    if match:
        content = match.group(1)
        
        # Extract header actions
        actions_match = re.search(r'<div class="header-actions">(.*?)</div>', content, re.DOTALL)
        header_actions = actions_match.group(1) if actions_match else ""
        
        # Remove standard header
        content = re.sub(r'<header class="app-header glass-header">.*?</header>', '', content, flags=re.DOTALL)
        
        # Unpack main
        content = re.sub(r'<main class="content pad-content"[^>]*>', '', content)
        content = re.sub(r'</main>', '', content)
        
        # Inject header actions as a local toolbar
        if header_actions.strip():
            toolbar = f'<div style="display:flex; justify-content:flex-end; margin-bottom: 1rem;">{header_actions}</div>'
            content = toolbar + content
            
        tab_content = f'<div id="{tab_id}" class="admin-tab-pane">\n{content}\n</div>'
        html = html.replace('<!-- End tab-students -->', f'<!-- End tab-students -->\n{tab_content}')
        html = html.replace(match.group(0), '')

# Re-close admin-view
html = html.replace('<!-- End tab-students -->', '<!-- All Tabs -->\n            </main>\n        </section>\n\n        <!-- Parent View -->')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("Transformation completed")
