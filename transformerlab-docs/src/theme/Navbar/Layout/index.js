import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import { ThemeClassNames, useThemeConfig } from '@docusaurus/theme-common';
import {
  useHideableNavbar,
  useNavbarMobileSidebar,
} from '@docusaurus/theme-common/internal';
import { translate } from '@docusaurus/Translate';
import NavbarMobileSidebar from '@theme/Navbar/MobileSidebar';
import styles from './styles.module.css';

function NavbarBackdrop({ onClick }) {
  return (
    <div
      role="presentation"
      onClick={onClick}
      className="navbar-sidebar__backdrop"
    />
  );
}

export default function NavbarLayout({ children }) {
  const {
    navbar: { hideOnScroll, style },
  } = useThemeConfig();
  const { pathname } = useLocation();
  const mobileSidebar = useNavbarMobileSidebar();
  const { navbarRef, isNavbarVisible } = useHideableNavbar(hideOnScroll);
  const isDeprecatedInstallRoute =
    pathname === '/docs/category/install' ||
    pathname === '/docs/install' ||
    pathname.startsWith('/docs/category/install/') ||
    pathname.startsWith('/docs/install/');

  return (
    <>
      {isDeprecatedInstallRoute && (
        <div className={styles.deprecatedInstallBanner} role="status">
          <span>
            This page is no longer maintained. See the latest setup steps on
            the{' '}
          </span>
          <Link to="/for-teams/install">For Teams install page</Link>.
        </div>
      )}
      <nav
        ref={navbarRef}
        aria-label={translate({
          id: 'theme.NavBar.navAriaLabel',
          message: 'Main',
          description: 'The ARIA label for the main navigation',
        })}
        className={clsx(
          ThemeClassNames.layout.navbar.container,
          'navbar',
          'navbar--fixed-top',
          hideOnScroll && [
            styles.navbarHideable,
            !isNavbarVisible && styles.navbarHidden,
          ],
          {
            'navbar--dark': style === 'dark',
            'navbar--primary': style === 'primary',
            'navbar-sidebar--show': mobileSidebar.shown,
          },
        )}
      >
        {children}
        <NavbarBackdrop onClick={mobileSidebar.toggle} />
        <NavbarMobileSidebar />
      </nav>
    </>
  );
}
