FROM ubuntu:jammy

SHELL ["/bin/bash", "-c"]

## for apt to be noninteractive
ENV DEBIAN_FRONTEND="noninteractive"
ENV DEBCONF_NONINTERACTIVE_SEEN="true"

RUN apt-get update && \
    apt-get -y install sudo

RUN mkdir -p /tools
WORKDIR /tools

# Install dependencies
RUN sudo apt-get install -y apt-utils && \
    echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections

RUN sudo apt-get update && \
    sudo apt-get upgrade -y && \
    sudo apt-get install -y --fix-missing \
    apt-transport-https \
    build-essential \
    ca-certificates \
    curl \
    git \
    libssl-dev \
    wget \
    software-properties-common \
    python3-full \
    python3-pip \
    python3-dev \
    python-is-python3 \
    g++ \
    gcc \
    gawk \
    bison \
    flex \
    npm \
    default-jre \
    links2

# install php5.6
RUN sudo add-apt-repository ppa:ondrej/php -y && \
    sudo apt update -y && \
    sudo apt upgrade -y

## preesed tzdata, update package index, upgrade packages and install needed software
RUN echo "tzdata tzdata/Areas select Europe" > /tmp/preseed.txt; \
    echo "tzdata tzdata/Zones/Europe select Warsaw" >> /tmp/preseed.txt; \
    sudo debconf-set-selections /tmp/preseed.txt && \
    sudo apt-get update && \
    sudo apt-get install -y tzdata

RUN sudo apt-get -yq install php5.6 && \
    sudo apt-get install php5.6-gd php5.6-mysql php5.6-imap php5.6-curl php5.6-intl php5.6-pspell php5.6-recode php5.6-sqlite3 php5.6-tidy php5.6-xmlrpc php5.6-xsl php5.6-zip php5.6-mbstring php5.6-soap php5.6-opcache php5.6-common php5.6-json php5.6-readline php5.6-xml libapache2-mod-php5.6 php5.6-cli build-essential python3-dev autotools-dev libicu-dev libbz2-dev libboost-all-dev -y && \
    sudo a2enmod php5.6 && \
    sudo service apache2 restart

RUN pip install --upgrade pip && \
    pip install h5py docutils psutil mrcfile pango fonts

# Install MolProbity
#  RUN wget -O install_via_bootstrap.sh https://github.com/rlabduke/MolProbity/raw/master/install_via_bootstrap.sh && \
#      sudo chmod +x install_via_bootstrap.sh && \
#      ./install_via_bootstrap.sh 4 && \
#      ./molprobity/setup.sh

# copy and extract molprobity
# COPY --chown=root:root ./precompiled/molprobity.tar.gz.part* /tools/
COPY --chown=root:root ./precompiled/molprobity.tar.gz /tools/
COPY ./src ./package.json pnpm-lock.yaml nodemon.json tsconfig.json /webserver/
RUN chmod -R 777 /tools
#RUN /bin/bash -c cat /tools/molprobity.tar.gz.part* > /tools/molprobity.tar.gz && sync && rm /tools/molprobity.tar.gz.part*
RUN tar -xzf /tools/molprobity.tar.gz &&     rm /tools/molprobity.tar.gz

ENV PATH="$PATH:/tools/molprobity/molprobity/cmdline"

WORKDIR /webserver

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
ENV NVM_DIR=/root/.nvm
ENV NODE_VERSION=20.3.0

RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"

RUN npm install -g pnpm && \
    pnpm install && \
    pnpm build

EXPOSE 3001

CMD ["pnpm", "start"]
