%define _build_id_links none
%define debug_package %{nil}
%global __os_install_post %{nil}

Name:           exer-client
Version:        0.5.99
Release:        1%{?dist}
Summary:        EXER Client for Minecraft Java Edition
License:        Proprietary
URL:            https://exerclient.com
AutoReqProv:    no

%description
EXER Client is an independent Minecraft Java Edition client with EXER Core,
Fabric, Sodium and 3D Cosmetics.

%install
rm -rf "%{buildroot}"
mkdir -p "%{buildroot}/opt/exer-client"
mkdir -p "%{buildroot}%{_bindir}"
mkdir -p "%{buildroot}%{_datadir}/applications"
mkdir -p "%{buildroot}%{_datadir}/icons/hicolor/256x256/apps"

cp -a "%{_sourcedir}/exer-client-linux-x64/." "%{buildroot}/opt/exer-client/"
ln -s "/opt/exer-client/exer-client.sh" "%{buildroot}%{_bindir}/exer-client"
if [ -f "%{buildroot}/opt/exer-client/exer-update" ]; then
    ln -s "/opt/exer-client/exer-update" "%{buildroot}%{_bindir}/exer-update"
fi

install -m 644 "%{_sourcedir}/exer-client.desktop" "%{buildroot}%{_datadir}/applications/exer-client.desktop"
if [ -f "%{_sourcedir}/exer-updater.desktop" ]; then
    install -m 644 "%{_sourcedir}/exer-updater.desktop" "%{buildroot}%{_datadir}/applications/exer-updater.desktop"
fi
install -m 644 "%{_sourcedir}/exer-client.png" "%{buildroot}%{_datadir}/icons/hicolor/256x256/apps/exer-client.png"

%files
/opt/exer-client
%{_bindir}/exer-client
%{_bindir}/exer-update*
%{_datadir}/applications/exer-client.desktop
%{_datadir}/applications/exer-updater.desktop*
%{_datadir}/icons/hicolor/256x256/apps/exer-client.png

%post
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q %{_datadir}/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f %{_datadir}/icons/hicolor || true
fi

%postun
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q %{_datadir}/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f %{_datadir}/icons/hicolor || true
fi
