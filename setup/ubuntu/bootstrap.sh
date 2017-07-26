#!/bin/bash
#
# This script setups Redash along with supervisor, nginx, PostgreSQL and Redis. It was written to be used on
# Ubuntu 16.04. Technically it can work with other Ubuntu versions, but you might get non compatible versions
# of PostgreSQL, Redis and maybe some other dependencies.
#
# This script is not idempotent and if it stops in the middle, you can't just run it again. You should either
# understand what parts of it to exclude or just start over on a new VM (assuming you're using a VM).

set -eu

REDASH_BASE_PATH=/opt/redash
REDASH_BRANCH="${REDASH_BRANCH:-master}" # Default branch/version to master if not specified in REDASH_BRANCH env var
REDASH_VERSION=`date +%Y%m%d%H%M%S`
LATEST_URL="https://github.com/moritz9/redash/archive/${REDASH_BRANCH}.zip"
VERSION_DIR="/opt/redash/redash.${REDASH_BRANCH}.${REDASH_VERSION}"
REDASH_ZIP=/tmp/redash.zip
FILES_BASE_URL=https://raw.githubusercontent.com/moritz9/redash/${REDASH_BRANCH}/setup/ubuntu/files

cd /tmp/

verify_root() {
    # Verify running as root:
    if [ "$(id -u)" != "0" ]; then
        if [ $# -ne 0 ]; then
            echo "Failed running with sudo. Exiting." 1>&2
            exit 1
        fi
        echo "This script must be run as root. Trying to run with sudo."
        sudo bash "$0" --with-sudo
        exit 0
    fi
}

create_redash_user() {
    adduser --system --no-create-home --disabled-login --gecos "" redash
}

install_system_packages() {
    apt-get -y update
    # Base packages
    apt install -y python-pip python-dev nginx curl build-essential pwgen
    # Data sources dependencies:
    apt install -y libffi-dev libssl-dev libmysqlclient-dev libpq-dev freetds-dev libsasl2-dev
    # SAML dependency
    apt install -y xmlsec1
    # Storage servers
    apt install -y postgresql redis-server
    apt install -y supervisor
    # unzip tool
    apt install -y unzip
    # npm for JavaScript Node compilation
    apt install -y npm
    apt install -y nodejs-legacy
    np
}

create_directories() {
    mkdir /opt/redash
    chown redash /opt/redash

    # Default config file
    if [ ! -f "/opt/redash/.env" ]; then
        sudo -u redash wget "$FILES_BASE_URL/env" -O /opt/redash/.env
    fi

    COOKIE_SECRET=$(pwgen -1s 32)
    echo "export REDASH_COOKIE_SECRET=$COOKIE_SECRET" >> /opt/redash/.env
}

extract_redash_sources() {
    sudo -u redash wget "$LATEST_URL" -O "$REDASH_ZIP"
    sudo -u redash mkdir "$VERSION_DIR"
    sudo -u redash unzip "$REDASH_ZIP" -d "$VERSION_DIR"
    ln -nfs "$VERSION_DIR"/redash-"$REDASH_BRANCH" /opt/redash/current
    ln -nfs /opt/redash/.env /opt/redash/current/.env
}

install_python_packages() {
    pip install --upgrade pip
    # TODO: venv?
    pip install setproctitle # setproctitle is used by Celery for "pretty" process titles
    pip install -r /opt/redash/current/requirements.txt
    pip install -r /opt/redash/current/requirements_all_ds.txt
    pip install -r /opt/redash/current/requirements_dev.txt
}

create_database() {
    # Create user and database
    sudo -u postgres createuser redash --no-superuser --no-createdb --no-createrole
    sudo -u postgres createdb redash --owner=redash

    cd /opt/redash/current
    sudo -u redash bin/run ./manage.py database create_tables
}

compile_node_webapp() {
    cd /opt/redash/current
    sudo npm install
    sudo -u redash npm run build
}

setup_supervisor() {
    wget -O /etc/supervisor/conf.d/redash.conf "$FILES_BASE_URL/supervisord.conf"
    service supervisor restart
}

setup_nginx() {
    rm /etc/nginx/sites-enabled/default
    wget -O /etc/nginx/sites-available/redash "$FILES_BASE_URL/nginx_redash_site"
    ln -nfs /etc/nginx/sites-available/redash /etc/nginx/sites-enabled/redash
    service nginx restart
}

verify_root
install_system_packages
create_redash_user
create_directories
extract_redash_sources
install_python_packages
create_database
compile_node_webapp
setup_supervisor
setup_nginx
