pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
    }

    parameters {
        booleanParam(
            name: 'MANUAL_ROLLBACK',
            defaultValue: false,
            description: 'Check to roll back EC2 production directly to a previous image tag'
        )
        string(
            name: 'ROLLBACK_TAG',
            defaultValue: '',
            description: 'Optional target tag for manual rollback (leave blank to restore LAST_GOOD_TAG on EC2)'
        )
    }

    environment {
        REGISTRY_PREFIX = credentials('freshguard-registry-prefix')
        DOCKER_CREDS    = credentials('freshguard-registry-creds')
        EC2_HOST        = credentials('freshguard-ec2-host')
        EC2_USER        = credentials('freshguard-ec2-user')
        DEPLOY_DIR      = '/opt/freshguard-inventory'
        TRIVY_SEVERITY  = 'CRITICAL'
        DEPLOY_STARTED  = 'false'
    }

    stages {
        stage('1. Source-Code Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()
                    env.IMAGE_TAG = "${env.GIT_COMMIT_SHORT}-${env.BUILD_NUMBER}"
                    echo "Building FreshGuard tag: ${env.IMAGE_TAG}"
                }
            }
        }

        stage('Manual Rollback Shortcut') {
            when { expression { return params.MANUAL_ROLLBACK == true } }
            steps {
                sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                          "cd ${DEPLOY_DIR} && ./scripts/deploy.sh --rollback '${ROLLBACK_TAG}'"
                    '''
                }
            }
        }

        stage('2. Dependency Installation') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    cd backend && npm ci
                    cd ../frontend && npm ci
                    cd ../ml-service
                    if python3 -m venv .venv 2>/dev/null; then
                        . .venv/bin/activate && pip install -r requirements.txt
                    else
                        echo "python3-venv unavailable on host; Stage 6 will run ML tests via python:3.11-slim Docker container."
                        rm -rf .venv
                    fi
                '''
            }
        }

        stage('3. Secret & Security Checks') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    if command -v gitleaks >/dev/null 2>&1; then
                        gitleaks detect --source . --config .gitleaks.toml --no-git --exit-code 1
                    else
                        echo "Running fallback regex secret guard (install gitleaks on CI host for full scan)"
                        ! grep -rnE "AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}" \
                          backend/src frontend/src ml-service/app scripts Jenkinsfile
                    fi
                '''
            }
        }

        stage('4-6. Automated Testing (Backend, Frontend, ML)') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            parallel {
                stage('4. Backend Testing') {
                    steps {
                        sh 'cd backend && npm run lint && npm test'
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'backend/coverage/**', allowEmptyArchive: true
                        }
                    }
                }
                stage('5. Frontend Testing') {
                    steps {
                        sh 'cd frontend && npm run lint && npm test && npm run build'
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'frontend/coverage/**', allowEmptyArchive: true
                        }
                    }
                }
                stage('6. ML-Service Testing') {
                    steps {
                        sh '''
                            cd ml-service
                            if [ -x .venv/bin/pytest ]; then
                                . .venv/bin/activate && pytest --cov=app --cov-report=xml:coverage.xml
                            else
                                docker run --rm -v "$PWD:/app" -w /app python:3.11-slim sh -c \
                                  "pip install --no-cache-dir -q -r requirements.txt && pytest --cov=app --cov-report=xml:coverage.xml && chown -R $(id -u):$(id -g) /app"
                            fi
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'ml-service/coverage.xml', allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        stage('7. Code-Quality Analysis (SonarQube)') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                withSonarQubeEnv('SonarQubeServer') {
                    sh '''
                        if command -v sonar-scanner >/dev/null 2>&1; then
                            sonar-scanner -Dsonar.projectVersion=${IMAGE_TAG}
                        else
                            docker run --rm --network host \
                              -e SONAR_HOST_URL="${SONAR_HOST_URL}" \
                              -e SONAR_TOKEN="${SONAR_AUTH_TOKEN}" \
                              -v "$PWD:/usr/src" -w /usr/src \
                              sonarsource/sonar-scanner-cli:latest \
                              -Dsonar.projectVersion=${IMAGE_TAG}
                        fi
                    '''
                }
            }
        }

        stage('8. Dependency Vulnerability Scanning') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    cd backend && npm audit --omit=dev --audit-level=critical
                    cd ../frontend && npm audit --omit=dev --audit-level=critical
                    cd ../ml-service
                    if [ -x .venv/bin/pip-audit ]; then
                        . .venv/bin/activate && pip-audit
                    else
                        echo "pip-audit skipped (install python3-venv + pip-audit on agent for Python CVE check)"
                    fi
                    if command -v dependency-check.sh >/dev/null 2>&1; then
                        dependency-check.sh --project FreshGuard --scan . --format HTML --format JSON \
                          --out dependency-check-report --failOnCVSS 9 --exclude "**/node_modules/**" --exclude "**/.venv/**"
                    else
                        echo "OWASP dependency-check CLI not found; install on Jenkins agent for full NVD CVE report."
                    fi
                '''
            }
        }

        stage('9. Docker Image Building') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    docker build -t ${REGISTRY_PREFIX}/freshguard-backend:${IMAGE_TAG} ./backend
                    docker build -t ${REGISTRY_PREFIX}/freshguard-ml:${IMAGE_TAG} ./ml-service
                    docker build -t ${REGISTRY_PREFIX}/freshguard-frontend:${IMAGE_TAG} ./frontend
                '''
            }
        }

        stage('10. Docker Image Vulnerability Scanning (Trivy)') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    mkdir -p trivy-reports
                    if command -v trivy >/dev/null 2>&1; then
                        trivy image --ignore-unfixed --severity CRITICAL,HIGH --format json -o trivy-reports/backend.json ${REGISTRY_PREFIX}/freshguard-backend:${IMAGE_TAG}
                        trivy image --ignore-unfixed --severity CRITICAL,HIGH --format json -o trivy-reports/ml.json ${REGISTRY_PREFIX}/freshguard-ml:${IMAGE_TAG}
                        trivy image --ignore-unfixed --severity CRITICAL,HIGH --format json -o trivy-reports/frontend.json ${REGISTRY_PREFIX}/freshguard-frontend:${IMAGE_TAG}
                    else
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/trivy-reports:/reports" aquasec/trivy:latest image --ignore-unfixed --severity CRITICAL,HIGH --format json -o /reports/backend.json ${REGISTRY_PREFIX}/freshguard-backend:${IMAGE_TAG}
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/trivy-reports:/reports" aquasec/trivy:latest image --ignore-unfixed --severity CRITICAL,HIGH --format json -o /reports/ml.json ${REGISTRY_PREFIX}/freshguard-ml:${IMAGE_TAG}
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/trivy-reports:/reports" aquasec/trivy:latest image --ignore-unfixed --severity CRITICAL,HIGH --format json -o /reports/frontend.json ${REGISTRY_PREFIX}/freshguard-frontend:${IMAGE_TAG}
                    fi
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'trivy-reports/*.json', allowEmptyArchive: true
                }
            }
        }

        stage('11. Quality and Security Gates') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
                sh '''
                    if command -v trivy >/dev/null 2>&1; then
                        trivy image --exit-code 1 --ignore-unfixed --severity ${TRIVY_SEVERITY} ${REGISTRY_PREFIX}/freshguard-backend:${IMAGE_TAG}
                        trivy image --exit-code 1 --ignore-unfixed --severity ${TRIVY_SEVERITY} ${REGISTRY_PREFIX}/freshguard-ml:${IMAGE_TAG}
                        trivy image --exit-code 1 --ignore-unfixed --severity ${TRIVY_SEVERITY} ${REGISTRY_PREFIX}/freshguard-frontend:${IMAGE_TAG}
                    else
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --exit-code 1 --ignore-unfixed --severity ${TRIVY_SEVERITY} ${REGISTRY_PREFIX}/freshguard-backend:${IMAGE_TAG}
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --exit-code 1 --ignore-unfixed --severity ${TRIVY_SEVERITY} ${REGISTRY_PREFIX}/freshguard-ml:${IMAGE_TAG}
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --exit-code 1 --ignore-unfixed --severity ${TRIVY_SEVERITY} ${REGISTRY_PREFIX}/freshguard-frontend:${IMAGE_TAG}
                    fi
                '''
            }
        }

        stage('12. Push Approved Images to Registry') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh '''
                    echo "${DOCKER_CREDS_PSW}" | docker login -u "${DOCKER_CREDS_USR}" --password-stdin
                    docker push ${REGISTRY_PREFIX}/freshguard-backend:${IMAGE_TAG}
                    docker push ${REGISTRY_PREFIX}/freshguard-ml:${IMAGE_TAG}
                    docker push ${REGISTRY_PREFIX}/freshguard-frontend:${IMAGE_TAG}
                    docker logout
                '''
            }
        }

        stage('13. Deploy to AWS EC2') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                script {
                    env.DEPLOY_STARTED = 'true'
                }
                sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                          "sudo mkdir -p ${DEPLOY_DIR}/scripts && sudo chown -R ${EC2_USER}:${EC2_USER} ${DEPLOY_DIR}"
                        scp -o StrictHostKeyChecking=accept-new docker-compose.prod.yml ${EC2_USER}@${EC2_HOST}:${DEPLOY_DIR}/docker-compose.prod.yml
                        scp -o StrictHostKeyChecking=accept-new scripts/deploy.sh scripts/smoke-test.sh scripts/init-db.sh ${EC2_USER}@${EC2_HOST}:${DEPLOY_DIR}/scripts/
                        ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                          "chmod +x ${DEPLOY_DIR}/scripts/*.sh && cd ${DEPLOY_DIR} && ./scripts/deploy.sh --deploy '${REGISTRY_PREFIX}' '${IMAGE_TAG}'"
                    '''
                }
            }
        }

        stage('14. Database Initialization & Index Checks') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                          "cd ${DEPLOY_DIR} && ./scripts/init-db.sh"
                    '''
                }
            }
        }

        stage('15. Smoke Tests & Health Checks') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sh './scripts/smoke-test.sh "http://${EC2_HOST}"'
            }
        }

        stage('16. Monitor Deployment') {
            when { expression { return params.MANUAL_ROLLBACK == false } }
            steps {
                sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                    sh '''
                        ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                          "cd ${DEPLOY_DIR} && docker compose -f docker-compose.prod.yml ps && docker logs --tail 25 freshguard-backend"
                    '''
                }
            }
        }
    }

    post {
        failure {
            script {
                if (params.MANUAL_ROLLBACK == false && env.DEPLOY_STARTED == 'true') {
                    echo '17. Automated Rollback triggered due to deployment failure!'
                    try {
                        sshagent(credentials: ['freshguard-ec2-ssh-key']) {
                            sh '''
                                ssh -o StrictHostKeyChecking=accept-new ${EC2_USER}@${EC2_HOST} \
                                  "cd ${DEPLOY_DIR} && ./scripts/deploy.sh --rollback" || true
                            '''
                        }
                    } catch (err) {
                        echo "Automated rollback skipped or failed: ${err.message}"
                    }
                }
            }
        }
    }
}
