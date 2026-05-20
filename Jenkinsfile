pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        timestamps()
    }

    environment {
        APP_NAME = 'flow-retail'
        IMAGE_NAME = 'flow-retail'
        DOCKER_NETWORK = 'flow-net'

        JENKINS_CONTAINER = 'jenkins_modern'

        STAGING_CONTAINER = 'flow-staging'
        PROD_CONTAINER = 'flow-prod'

        PROMETHEUS_CONTAINER = 'flow-prometheus'
        ALERTMANAGER_CONTAINER = 'flow-alertmanager'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm

                sh '''
                    echo "Current Jenkins workspace:"
                    pwd

                    echo "Files in workspace:"
                    ls -la

                    echo "Checking package files:"
                    ls -la package*.json

                    echo "Checking Docker version:"
                    docker --version
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    echo "Installing Node.js dependencies inside Docker..."

                    docker run --rm \
                      --volumes-from $JENKINS_CONTAINER \
                      -w "$PWD" \
                      -e npm_config_cache=/tmp/.npm \
                      node:20-bookworm \
                      bash -lc "pwd && ls -la package*.json && npm ci"
                '''
            }
        }

        stage('Build') {
            steps {
                sh '''
                    echo "Initialising SQLite database..."

                    docker run --rm \
                      --volumes-from $JENKINS_CONTAINER \
                      -w "$PWD" \
                      -e npm_config_cache=/tmp/.npm \
                      node:20-bookworm \
                      bash -lc "npm run init-db"

                    echo "Building Docker image..."

                    docker build -t $IMAGE_NAME:$BUILD_NUMBER .
                    docker tag $IMAGE_NAME:$BUILD_NUMBER $IMAGE_NAME:latest

                    echo "Saving Docker image as build artefact..."

                    mkdir -p artifacts
                    docker save $IMAGE_NAME:$BUILD_NUMBER | gzip > artifacts/$IMAGE_NAME-$BUILD_NUMBER.tar.gz
                '''
            }

            post {
                always {
                    archiveArtifacts allowEmptyArchive: true, artifacts: 'artifacts/*.tar.gz', fingerprint: true
                }
            }
        }

        stage('Test') {
            steps {
                sh '''
                    echo "Running automated Jest/Supertest tests..."

                    docker run --rm \
                      --volumes-from $JENKINS_CONTAINER \
                      -w "$PWD" \
                      -e NODE_ENV=test \
                      -e SKIP_EMAIL=true \
                      -e SESSION_SECRET=jenkins-test-session-secret \
                      -e STRIPE_SECRET_KEY=sk_test_dummy_key_for_tests \
                      -e npm_config_cache=/tmp/.npm \
                      node:20-bookworm \
                      bash -lc "npm ci && npm run init-db && npm test"
                '''
            }

            post {
                always {
                    junit allowEmptyResults: true, testResults: 'reports/junit/*.xml'
                    archiveArtifacts allowEmptyArchive: true, artifacts: 'coverage/**,reports/**'
                }
            }
        }

        stage('Code Quality') {
            steps {
                withCredentials([
                    string(credentialsId: 'SONAR_TOKEN', variable: 'SONAR_TOKEN')
                ]) {
                    sh '''
                        echo "Running SonarCloud code quality scan..."

                        docker run --rm \
                          --user root \
                          --volumes-from $JENKINS_CONTAINER \
                          -w "$PWD" \
                          -e SONAR_HOST_URL="https://sonarcloud.io" \
                          -e SONAR_TOKEN="$SONAR_TOKEN" \
                          sonarsource/sonar-scanner-cli:latest
                    '''
                }
            }
        }

        stage('Security') {
            steps {
                sh '''
                    echo "Running security scans..."

                    mkdir -p reports/security

                    echo "Running Trivy filesystem scan..."

                    docker run --rm \
                      --user root \
                      --volumes-from $JENKINS_CONTAINER \
                      -w "$PWD" \
                      aquasec/trivy:latest fs \
                      --severity LOW,MEDIUM,HIGH,CRITICAL \
                      --format table \
                      --output reports/security/trivy-fs.txt \
                      . || true

                    echo "Running Trivy Docker image scan..."

                    docker run --rm \
                      --user root \
                      -v /var/run/docker.sock:/var/run/docker.sock \
                      --volumes-from $JENKINS_CONTAINER \
                      -w "$PWD" \
                      aquasec/trivy:latest image \
                      --severity LOW,MEDIUM,HIGH,CRITICAL \
                      --format table \
                      --output reports/security/trivy-image.txt \
                      $IMAGE_NAME:$BUILD_NUMBER || true

                    echo "Running npm audit..."

                    docker run --rm \
                      --volumes-from $JENKINS_CONTAINER \
                      -w "$PWD" \
                      -e npm_config_cache=/tmp/.npm \
                      node:20-bookworm \
                      bash -lc "npm audit --audit-level=high > reports/security/npm-audit.txt || true"
                '''
            }

            post {
                always {
                    archiveArtifacts allowEmptyArchive: true, artifacts: 'reports/security/**'
                }
            }
        }

        stage('Deploy to Staging') {
            steps {
                withCredentials([
                    string(credentialsId: 'STRIPE_SECRET_KEY', variable: 'STRIPE_SECRET_KEY'),
                    string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET'),
                    usernamePassword(credentialsId: 'GMAIL_SMTP', usernameVariable: 'EMAIL_USER', passwordVariable: 'EMAIL_PASS')
                ]) {
                    sh '''
                        echo "Creating Docker network if it does not exist..."
                        docker network create $DOCKER_NETWORK || true

                        echo "Removing old staging container..."
                        docker rm -f $STAGING_CONTAINER || true

                        echo "Deploying application to staging environment..."

                        docker run -d \
                          --name $STAGING_CONTAINER \
                          --network $DOCKER_NETWORK \
                          -p 3001:3000 \
                          -e NODE_ENV=staging \
                          -e PORT=3000 \
                          -e STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
                          -e SESSION_SECRET="$SESSION_SECRET" \
                          -e EMAIL_USER="$EMAIL_USER" \
                          -e EMAIL_PASS="$EMAIL_PASS" \
                          -e SKIP_EMAIL=true \
                          $IMAGE_NAME:$BUILD_NUMBER

                        echo "Waiting for staging app health check..."

                        for i in $(seq 1 20); do
                          echo "Staging health check attempt $i..."

                          if docker run --rm --network $DOCKER_NETWORK curlimages/curl:8.10.1 \
                            -fsS http://$STAGING_CONTAINER:3000/health; then
                            echo "Staging app is healthy."
                            exit 0
                          fi

                          echo "Staging app not ready yet. Showing recent logs:"
                          docker ps -a --filter "name=$STAGING_CONTAINER"
                          docker logs --tail 30 $STAGING_CONTAINER || true

                          sleep 3
                        done

                        echo "Staging health check failed."
                        exit 1
                    '''
                }
            }
        }

        stage('Release to Production') {
            steps {
                withCredentials([
                    string(credentialsId: 'STRIPE_SECRET_KEY', variable: 'STRIPE_SECRET_KEY'),
                    string(credentialsId: 'SESSION_SECRET', variable: 'SESSION_SECRET'),
                    usernamePassword(credentialsId: 'GMAIL_SMTP', usernameVariable: 'EMAIL_USER', passwordVariable: 'EMAIL_PASS')
                ]) {
                    sh '''
                        echo "Tagging production release image..."

                        docker tag $IMAGE_NAME:$BUILD_NUMBER $IMAGE_NAME:prod-$BUILD_NUMBER
                        docker tag $IMAGE_NAME:$BUILD_NUMBER $IMAGE_NAME:production

                        echo "Removing old production container..."
                        docker rm -f $PROD_CONTAINER || true

                        echo "Releasing application to production environment..."

                        docker run -d \
                          --name $PROD_CONTAINER \
                          --network $DOCKER_NETWORK \
                          -p 3002:3000 \
                          -e NODE_ENV=production \
                          -e PORT=3000 \
                          -e STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
                          -e SESSION_SECRET="$SESSION_SECRET" \
                          -e EMAIL_USER="$EMAIL_USER" \
                          -e EMAIL_PASS="$EMAIL_PASS" \
                          -e SKIP_EMAIL=true \
                          $IMAGE_NAME:prod-$BUILD_NUMBER

                        echo "Waiting for production app health check..."

                        for i in $(seq 1 20); do
                          echo "Production health check attempt $i..."

                          if docker run --rm --network $DOCKER_NETWORK curlimages/curl:8.10.1 \
                            -fsS http://$PROD_CONTAINER:3000/health; then
                            echo "Production app is healthy."
                            exit 0
                          fi

                          echo "Production app not ready yet. Showing recent logs:"
                          docker ps -a --filter "name=$PROD_CONTAINER"
                          docker logs --tail 30 $PROD_CONTAINER || true

                          sleep 3
                        done

                        echo "Production health check failed."
                        exit 1
                    '''
                }
            }
        }

        stage('Monitoring and Alerting') {
            steps {
                sh '''
                    echo "Starting monitoring and alerting services..."

                    docker rm -f $PROMETHEUS_CONTAINER $ALERTMANAGER_CONTAINER || true

                    echo "Creating Docker network if it does not exist..."
                    docker network create $DOCKER_NETWORK || true

                    echo "Starting Alertmanager..."

                    docker run -d \
                      --name $ALERTMANAGER_CONTAINER \
                      --network $DOCKER_NETWORK \
                      --volumes-from $JENKINS_CONTAINER \
                      -p 9093:9093 \
                      prom/alertmanager:latest \
                      --config.file=$PWD/monitoring/alertmanager.yml

                    echo "Starting Prometheus..."

                    docker run -d \
                      --name $PROMETHEUS_CONTAINER \
                      --network $DOCKER_NETWORK \
                      --volumes-from $JENKINS_CONTAINER \
                      -p 9090:9090 \
                      prom/prometheus:latest \
                      --config.file=$PWD/monitoring/prometheus.yml

                    echo "Waiting for monitoring services..."
                    sleep 10

                    echo "Checking Prometheus health through Docker network..."

                    docker run --rm --network $DOCKER_NETWORK curlimages/curl:8.10.1 \
                      -fsS http://$PROMETHEUS_CONTAINER:9090/-/healthy

                    echo "Checking production metrics endpoint through Docker network..."

                    docker run --rm --network $DOCKER_NETWORK curlimages/curl:8.10.1 \
                      -fsS http://$PROD_CONTAINER:3000/metrics | head
                '''
            }
        }
    }

    post {
        always {
            echo 'Pipeline finished. Check Jenkins stages, archived artifacts, SonarCloud, security reports, staging app, production app, and Prometheus.'
        }

        success {
            echo 'SUCCESS: Build, Test, Code Quality, Security, Deploy, Release, and Monitoring stages completed.'
        }

        failure {
            echo 'FAILED: Check the failed stage console output.'
        }
    }
}